import { apiSuccess, guardRoute, notFoundResponse } from "@/lib/http";
import { getMemberOverview } from "@/lib/me";
import { requireMember } from "@/lib/member-auth";
import { walletErrorResponse } from "@/lib/wallet-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me
 *
 * The signed-in member: their profile, their wallet balances, and the two numbers
 * the referral page shows. One call, so a home screen does not have to fan out to
 * `/api/session` and `/api/wallet` and stitch two answers together.
 *
 *   200 { user, wallet, stats, warnings }
 *   401 no member session
 *   404 NOT_FOUND — the account behind a still-valid session was deleted
 *   500 anything else
 *
 * `user` is a fixed key set: `googleId` (the provider's immutable id) and
 * `referredById` are on the same row and are not returned, because a member has no
 * use for either and both are better left inside the database. `wallet` is
 * `null`, never zeros, if the wallet row is missing — see `src/lib/me.ts`.
 *
 * Not to be confused with `GET /api/session`, which stays the slim identity check
 * the Android client and the sign-in flow already call. Both answers are the same
 * database read for the fields they share; this one is the one to use for a
 * screen that also shows money, because it is one request instead of two and it is
 * the one that can tell you a wallet is missing.
 *
 * `Cache-Control: no-store` comes from `apiJson`: a balance is personal, and a
 * cached one is a complaint waiting to happen.
 */
async function handleGET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const overview = await getMemberOverview(guard.userId);
    if (!overview) {
      return notFoundResponse("Account no longer exists");
    }
    return apiSuccess(overview);
  } catch (error) {
    // The only failure this route can produce comes from the wallet read, so the
    // wallet's error mapping is the right one to reuse rather than inventing a
    // second table for the same codes.
    return walletErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/me", handleGET);
