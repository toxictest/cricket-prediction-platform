import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  adminCookieName,
  adminCookieOptions,
  verifyAdminToken,
} from "@/lib/admin-session";

/**
 * Guard for admin route handlers. Call it first in every handler:
 *
 *   export async function GET() {
 *     const guard = await requireAdmin(["PAYMENT_ADMIN"]);
 *     if (!guard.ok) return guard.response;
 *     const { admin } = guard; // authenticated, roles included
 *     // ...
 *   }
 *
 * - No roles passed: any active admin passes.
 * - Roles passed: the admin needs at least one of them. SUPER_ADMIN is NOT an
 *   implicit pass. List it explicitly where Super Admins should be allowed.
 * - 401 when the cookie is missing, the JWT is invalid or expired, the session
 *   is revoked or expired, or the admin is deactivated.
 * - 403 when the session is valid but none of the required roles is held.
 *
 * Roles and `isActive` are read from the database on every call, so a role
 * change or deactivation applies to the very next request.
 *
 * Must run inside a request (route handler or server action), because it reads cookies.
 */

export type AdminPrincipal = {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  lastLoginAt: Date | null;
  sessionId: string;
  sessionExpiresAt: Date;
};

export type AdminGuardResult =
  | { ok: true; admin: AdminPrincipal }
  | { ok: false; response: NextResponse };

export async function requireAdmin(roles?: Role[]): Promise<AdminGuardResult> {
  const jar = await cookies();
  const token = jar.get(adminCookieName())?.value;
  if (!token) return unauthenticated();

  const claims = await verifyAdminToken(token);
  if (!claims) return unauthenticated({ clearCookie: true });

  const session = await prisma.adminSession.findUnique({
    where: { id: claims.sessionId },
    select: {
      adminId: true,
      expiresAt: true,
      revokedAt: true,
      admin: {
        select: {
          id: true,
          email: true,
          name: true,
          roles: true,
          isActive: true,
          lastLoginAt: true,
        },
      },
    },
  });

  if (
    !session ||
    session.adminId !== claims.adminId ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= Date.now() ||
    !session.admin.isActive
  ) {
    return unauthenticated({ clearCookie: true });
  }

  const { admin } = session;
  if (roles && roles.length > 0 && !roles.some((role) => admin.roles.includes(role))) {
    return forbidden();
  }

  return {
    ok: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      roles: admin.roles,
      lastLoginAt: admin.lastLoginAt,
      sessionId: claims.sessionId,
      sessionExpiresAt: session.expiresAt,
    },
  };
}

/**
 * JSON response for admin endpoints. It is never cached, and it can clear the
 * admin cookie.
 */
export function adminJson(
  body: unknown,
  status: number,
  options: { clearCookie?: boolean; headers?: Record<string, string> } = {},
): NextResponse {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...options.headers },
  });
  if (options.clearCookie) {
    response.cookies.set(adminCookieName(), "", adminCookieOptions(0));
  }
  return response;
}

function unauthenticated(options: { clearCookie?: boolean } = {}): AdminGuardResult {
  return {
    ok: false,
    response: adminJson(
      {
        ok: false,
        error: "Sign in as an administrator to continue.",
        code: "UNAUTHENTICATED",
      },
      401,
      options,
    ),
  };
}

function forbidden(): AdminGuardResult {
  return {
    ok: false,
    response: adminJson(
      {
        ok: false,
        error: "Your admin account does not have access to this action.",
        code: "FORBIDDEN",
      },
      403,
    ),
  };
}
