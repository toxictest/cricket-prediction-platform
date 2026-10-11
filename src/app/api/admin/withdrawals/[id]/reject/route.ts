import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { rejectWithdrawalRequest } from "@/lib/withdrawal";
import { parseRejectBody, withdrawalErrorResponse } from "@/lib/withdrawal-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYOUT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * POST /api/admin/withdrawals/:id/reject
 * Body: { reviewNote }   — required, so the member knows what to fix
 *
 * Refuses a payout and returns the tokens. One transaction does both: the
 * request moves to REJECTED with the note and the reviewer, and `refundWinning`
 * puts the amount back in `winningBalance` with a REFUND ledger row. Neither
 * half can land without the other, so there is no state where a member's money
 * is released while the request still looks open, or refused while the tokens
 * stay held.
 *
 * The refund can only return what the original WITHDRAWAL row took, and only
 * once for a given request. If a row and its debit disagree, this fails with
 * 422 REFUND_NOT_MATCHED and the request stays PENDING for a human to resolve.
 *
 *   200 { ok, data: { withdrawal, wallet, transaction } }
 *   400 missing or blank reviewNote
 *   401 / 403 wrong or missing admin session
 *   404 no such request
 *   409 already reviewed
 *   415 body is not application/json
 *   422 the refund did not match the debit
 *   503 money features switched off
 */
async function handlePOST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(PAYOUT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseRejectBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await rejectWithdrawalRequest(id, guard.admin.id, payload.reviewNote);
    return adminJson({ ok: true, data: result }, 200);
  } catch (error) {
    return withdrawalErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/withdrawals/[id]/reject", handlePOST);
