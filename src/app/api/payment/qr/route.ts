import { guardRoute, apiJson } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { getActivePaymentQr } from "@/lib/payment";
import { paymentErrorResponse } from "@/lib/payment-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payment/qr
 *
 * The UPI QR the member should pay into, taken from the newest LIVE match that
 * has a `qrCodeUrl`, or from the newest UPCOMING one if nothing is live.
 *
 *   200 { ok, data: { matchId, title, teamA, teamB, status, startTime, qrCodeUrl } }
 *   401 not signed in
 *   404 { code: "NO_ACTIVE_QR" }  nothing is published — hide the "Add money" panel
 *   503 { code: "PAYMENTS_DISABLED" }  money features are switched off
 *
 * `no-store` matters: an admin can swap the QR between matches, and a cached
 * image would send money to the wrong account.
 */
async function handleGET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const qr = await getActivePaymentQr();
    return apiJson({ ok: true, data: qr }, 200);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/payment/qr", handleGET);
