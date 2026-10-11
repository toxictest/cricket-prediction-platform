import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { rejectPaymentRequest } from "@/lib/payment";
import { parseRejectBody, paymentErrorResponse } from "@/lib/payment-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * POST /api/admin/payments/:id/reject
 * Body: { reviewNote }   — required, so the member is told why
 *
 * Moves a PENDING claim to REJECTED and records the reviewer and the note. No
 * wallet write: nothing was credited, so there is nothing to reverse. The
 * conditional update means a claim that was approved a second ago cannot be
 * rejected — that attempt gets 409 rather than silently rewriting history.
 *
 *   200 { ok, data: { payment } }
 *   400 missing or blank reviewNote
 *   401 / 403 wrong or missing admin session
 *   404 no such claim
 *   409 already reviewed
 *   415 body is not application/json
 *   503 money features switched off
 */
async function handlePOST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(PAYMENT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseRejectBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await rejectPaymentRequest(id, guard.admin.id, payload.reviewNote);
    return adminJson({ ok: true, data: result }, 200);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/payments/[id]/reject", handlePOST);
