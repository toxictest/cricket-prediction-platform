import type { NextRequest } from "next/server";
import { guardRoute, apiJson, parseQueueQuery } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { listMyWithdrawals } from "@/lib/withdrawal";
import { withdrawalErrorResponse } from "@/lib/withdrawal-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/withdrawal/my?status=PENDING&limit=20&cursor=...
 *
 * The signed-in member's payout requests, newest first, keyset-paged. Each row
 * says what was asked for, whether it was paid (`status`, `adminUtr`) and why it
 * was refused (`reviewNote`).
 *
 *   200 { items, nextCursor }
 *   400 bad status, limit or cursor
 *   401 not signed in
 *
 * `userId` in the query string is ignored: whose history this is comes from the
 * session and nothing else. The read is not gated on `MONEY_MODE`, so a member
 * can always see the state of a request they already made — including a payout
 * whose tokens are currently held.
 *
 * The balance the debit left behind is on `GET /api/wallet`; this list never
 * repeats a number that could go stale between the two responses.
 */
async function handleGET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const query = parseQueueQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  const { status, limit, cursor } = query.data;

  try {
    const page = await listMyWithdrawals(guard.userId, { status, limit, cursor });
    return apiJson({ ok: true, data: page }, 200);
  } catch (error) {
    return withdrawalErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/withdrawal/my", handleGET);
