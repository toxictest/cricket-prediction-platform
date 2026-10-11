import { cookies } from "next/headers";
import { adminJson } from "@/lib/admin-guard";
import {
  adminCookieName,
  revokeAdminSession,
  verifyAdminToken,
} from "@/lib/admin-session";
import { guardRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/logout
 *
 * Revokes the session on the server, then clears the cookie. It always
 * succeeds, even with no cookie or an invalid one, so the response reveals
 * nothing about the session.
 */
async function handlePOST() {
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

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/logout", handlePOST);
