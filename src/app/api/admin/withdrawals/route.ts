import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { listWithdrawalRequests } from "@/lib/withdrawal";
import { parseListQuery, withdrawalErrorResponse } from "@/lib/withdrawal-http";
import { guardRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only payment reviewers and Super Admins. SUPER_ADMIN is not an implicit pass, so it is listed. */
const PAYOUT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * GET /api/admin/withdrawals?status=PENDING&limit=20&cursor=...&userId=...
 *
 * The payout queue, newest first, keyset-paged. Each row carries the member
 * (name, email, referral code), the UPI ID to pay, the token amount and the
 * reviewer if it has one — everything needed to make the transfer, and nothing
 * else. `counts` covers the whole filtered queue, not just this page.
 *
 * Reading the queue is available even when `MONEY_MODE` is off: a request whose
 * tokens are already held is exactly the thing an operator must be able to look
 * at while the feature is dark. Only the two review actions are gated.
 */
async function handleGET(request: NextRequest) {
  const guard = await requireAdmin(PAYOUT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const query = parseListQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  try {
    const page = await listWithdrawalRequests(query.data);
    return adminJson({ ok: true, data: page }, 200);
  } catch (error) {
    return withdrawalErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/admin/withdrawals", handleGET);
