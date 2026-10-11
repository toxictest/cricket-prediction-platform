import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { approveWithdrawalRequest } from "@/lib/withdrawal";
import { parseApproveBody, withdrawalErrorResponse } from "@/lib/withdrawal-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYOUT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * POST /api/admin/withdrawals/:id/approve
 * Body: {} or { adminUtr }   — `application/json` is required, even with no fields
 *
 * Records that the payout to the member's UPI ID has been made. It changes no
 * balance: the tokens left `winningBalance` when the member filed the request,
 * which is why this endpoint can be called twice without paying twice — the
 * second call finds the request already APPROVED and gets 409.
 *
 * `adminUtr` is the reference of the outgoing transfer. Optional, because a P2P
 * UPI payout sometimes has none, but the member can read it here as proof.
 *
 *   200 { ok, data: { withdrawal } }
 *   401 / 403 wrong or missing admin session
 *   404 no such request
 *   409 already reviewed
 *   415 body is not application/json
 *   503 money features switched off
 */
async function handlePOST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(PAYOUT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, { allowEmpty: true });
  if (!body.ok) return body.response;

  const payload = parseApproveBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await approveWithdrawalRequest(id, guard.admin.id, payload.adminUtr);
    return adminJson({ ok: true, data: result }, 200);
  } catch (error) {
    return withdrawalErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/withdrawals/[id]/approve", handlePOST);
