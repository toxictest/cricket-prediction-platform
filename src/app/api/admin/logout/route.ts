import { cookies } from "next/headers";
import { adminJson } from "@/lib/admin-guard";
import {
  adminCookieName,
  revokeAdminSession,
  verifyAdminToken,
} from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/logout
 *
 * Revokes the session on the server, then clears the cookie. It always
 * succeeds, even with no cookie or an invalid one, so the response reveals
 * nothing about the session.
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(adminCookieName())?.value;

  if (token) {
    const claims = await verifyAdminToken(token);
    if (claims) await revokeAdminSession(claims.sessionId);
  }

  return adminJson({ ok: true, data: { signedOut: true } }, 200, {
    clearCookie: true,
  });
}
