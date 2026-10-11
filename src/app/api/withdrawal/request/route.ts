import type { NextRequest } from "next/server";
import { apiSuccess, featureDisabledResponse, guardRoute, rateLimitedResponse, readJsonBody } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { MONEY_MODE_OFF_MESSAGE, moneyModeEnabled } from "@/lib/feature-flags";
import { createWithdrawalRequest } from "@/lib/withdrawal";
import { parseCreateBody, withdrawalErrorResponse } from "@/lib/withdrawal-http";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * A payout request takes tokens out of a wallet, so it is throttled even though
 * an invalid amount cannot succeed. MAX_PENDING_PER_MEMBER in the service is the
 * limit that holds across instances; this one only blunts a flood on a warm one.
 */
const requestLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

/**
 * POST /api/withdrawal/request
 * Body: { amount, upiId }
 *
 * Asks for winnings to be paid out to a UPI ID. The tokens leave
 * `winningBalance` immediately, in the same transaction that files the request,
 * so the platform can never promise more than it already holds. The response
 * carries the new balances, which is all a client needs to refresh the screen.
 *
 *   201 the request, the debit, and the balances after it
 *   400 amount is not whole tokens, or upiId is not a VPA
 *   401 not signed in
 *   415 body is not application/json
 *   422 "Minimum 100 tokens must remain in wallet" — also the answer when the
 *       amount is larger than the winning balance
 *   429 too many requests, or too many payouts already waiting
 *   503 money features switched off
 *
 * Only winnings can be withdrawn. A deposit balance is not withdrawable, so a
 * member cannot move money in and back out again through this endpoint.
 */
async function handlePOST(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  if (!moneyModeEnabled()) {
    return featureDisabledResponse(MONEY_MODE_OFF_MESSAGE, "PAYMENTS_DISABLED");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseCreateBody(body.data);
  if (!payload.ok) return payload.response;

  const throttle = requestLimiter.hit(guard.userId);
  if (!throttle.allowed) {
    return rateLimitedResponse("Too many payout requests. Try again later.", throttle.retryAfterSeconds);
  }

  try {
    const receipt = await createWithdrawalRequest(guard.userId, payload.data);
    return apiSuccess(receipt, 201);
  } catch (error) {
    return withdrawalErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/withdrawal/request", handlePOST);
