import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { approvePaymentRequest } from "@/lib/payment";
import { parseApproveBody, paymentErrorResponse } from "@/lib/payment-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * POST /api/admin/payments/:id/approve
 * Body: {} or { reviewNote }   — `application/json` is required, even with no fields
 *
 * The only endpoint in the product that creates deposit balance. One database
 * transaction does all of it:
 *
 *   lock the claim → it must be PENDING → status APPROVED with reviewedBy
 *   → wallet credit → ledger row
 *
 * If the credit fails, the status change rolls back with it, so the claim stays
 * PENDING and can be approved again once the data is right.
 *
 *   200 { ok, data: { payment, wallet, transaction } }
 *   401 / 403 wrong or missing admin session
 *   404 no such claim
 *   409 already reviewed by somebody (a repeat call cannot credit twice)
 *   415 body is not application/json
 *   422 the wallet refused the credit (for example a token/rupee mismatch)
 *   503 money features switched off
 */
async function handlePOST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(PAYMENT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request, { allowEmpty: true });
  if (!body.ok) return body.response;

  const payload = parseApproveBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await approvePaymentRequest(id, guard.admin.id, payload.reviewNote);
    return adminJson({ ok: true, data: result }, 200);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/payments/[id]/approve", handlePOST);
