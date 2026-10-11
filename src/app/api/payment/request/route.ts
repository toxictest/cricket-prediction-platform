import type { NextRequest } from "next/server";
import { apiJson, featureDisabledResponse, readJsonBody } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { MONEY_MODE_OFF_MESSAGE, moneyModeEnabled } from "@/lib/feature-flags";
import { createPaymentRequest } from "@/lib/payment";
import { parseCreateBody, paymentErrorResponse } from "@/lib/payment-http";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Claims are cheap to file and expensive to review, so both limits stay in
 * place: this per-process throttle and, in the service, MAX_PENDING_PER_MEMBER
 * checked against the database. The database check is the one that holds across
 * instances; this one only stops a scripted flood on a warm instance.
 */
const claimLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

/**
 * POST /api/payment/request
 * Body: { amount, utrNumber, screenshotUrl }
 *
 * Files a claim for a UPI transfer already made by the member. It creates a
 * PENDING `PaymentRequest` and changes no balance. `tokensToCredit` is computed
 * here from `amount`; a client that sends it gets a 400.
 *
 *   201 the claim, with its id and status
 *   400 bad amount, bad UTR, bad URL, unexpected field
 *   401 not signed in
 *   409 this UTR is already on file — the same UTR cannot buy tokens twice
 *   415 body is not application/json
 *   429 too many claims from this member, or too many already pending
 *   503 money features switched off
 */
export async function POST(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  if (!moneyModeEnabled()) {
    return featureDisabledResponse(MONEY_MODE_OFF_MESSAGE, "PAYMENTS_DISABLED");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseCreateBody(body.data);
  if (!payload.ok) return payload.response;

  const throttle = claimLimiter.hit(guard.userId);
  if (!throttle.allowed) {
    return apiJson(
      {
        ok: false,
        error: "Too many claims from this account. Try again later.",
        code: "RATE_LIMITED",
      },
      429,
      { "Retry-After": String(throttle.retryAfterSeconds) },
    );
  }

  try {
    const receipt = await createPaymentRequest(guard.userId, payload.data);
    return apiJson({ ok: true, data: receipt }, 201);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
