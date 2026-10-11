import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { ApiError, ApiSuccess } from "@/types";
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

/**
 * The verification half of the guard: cookie → JWT → session row → admin, with no
 * role decision and no HTTP in it. `requireAdmin` wraps it in responses; the page
 * helpers in `src/lib/admin-web.ts` wrap it in a redirect. Keeping it shared means
 * a page and an API route can never disagree about who is signed in.
 */
export type AdminSessionLookup =
  | { ok: true; admin: AdminPrincipal }
  | { ok: false; clearCookie: boolean };

export async function readAdminSession(): Promise<AdminSessionLookup> {
  const jar = await cookies();
  const token = jar.get(adminCookieName())?.value;
  if (!token) return { ok: false, clearCookie: false };

  const claims = await verifyAdminToken(token);
  if (!claims) return { ok: false, clearCookie: true };

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
    return { ok: false, clearCookie: true };
  }

  const { admin } = session;

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
 * The admin behind the cookie, or `null`. For server components and pages, which
 * have no response object to return and would rather redirect or hide a section.
 *
 * A lookup failure that is not "no session" — an unset `ADMIN_SESSION_SECRET`,
 * which `verifyAdminToken` surfaces by throwing — is reported as `null` and
 * logged. A page must not 500 over a configuration fault: it sends the operator to
 * the sign-in screen, whose own request reports the fault in words.
 */
export async function getAdminPrincipal(): Promise<AdminPrincipal | null> {
  try {
    const found = await readAdminSession();
    return found.ok ? found.admin : null;
  } catch (error) {
    console.warn(
      "[admin-guard] page lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function requireAdmin(roles?: Role[]): Promise<AdminGuardResult> {
  const found = await readAdminSession();
  if (!found.ok) {
    return found.clearCookie ? unauthenticated({ clearCookie: true }) : unauthenticated();
  }

  const { admin } = found;
  if (roles && roles.length > 0 && !roles.some((role) => admin.roles.includes(role))) {
    return forbidden();
  }

  return { ok: true, admin };
}

/**
 * The admin half of the response vocabulary: the shared envelope plus the codes
 * only staff endpoints raise. `Omit<ApiError, "code">` rather than
 * `ApiError & { code: ... }` on purpose — intersecting the two would keep only
 * the codes they share, and `UNAUTHENTICATED` would compile to `never`. Widening a shared type per surface (here and in
 * `payment-http.ts`) is what keeps a typo in a `code` a compile error instead of
 * a client that silently falls into its generic branch.
 */
export type AdminApiError = Omit<ApiError, "code"> & {
  code:
    | ApiError["code"]
    /** No cookie, a cookie that will not verify, or a revoked session. */
    | "UNAUTHENTICATED"
    /** The password or the account is wrong. Never says which. */
    | "INVALID_CREDENTIALS"
    /** `ADMIN_SESSION_SECRET` is missing, short or still the placeholder. */
    | "ADMIN_NOT_CONFIGURED";
};

/** An admin error body, built once so the shape and the `no-store` cannot drift. */
export function adminErrorResponse(
  code: AdminApiError["code"],
  status: number,
  error: string,
  options: { details?: unknown; clearCookie?: boolean; headers?: Record<string, string> } = {},
): NextResponse {
  const body: AdminApiError = {
    ok: false,
    error,
    code,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
  return adminJson(body, status, { clearCookie: options.clearCookie, headers: options.headers });
}

/** Success body for admin endpoints, so a route does not hand-roll `{ ok: true }`. */
export function adminSuccess<T>(
  data: T,
  status = 200,
  options: { headers?: Record<string, string> } = {},
): NextResponse {
  const body: ApiSuccess<T> = { ok: true, data };
  return adminJson(body, status, options);
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
    response: adminErrorResponse(
      "UNAUTHENTICATED",
      401,
      "Sign in as an administrator to continue.",
      options,
    ),
  };
}

function forbidden(): AdminGuardResult {
  return {
    ok: false,
    response: adminErrorResponse(
      "FORBIDDEN",
      403,
      "Your admin account does not have access to this action.",
    ),
  };
}
