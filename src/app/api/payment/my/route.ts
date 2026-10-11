import type { NextRequest } from "next/server";
import { apiJson, guardRoute } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { parseListQuery, paymentErrorResponse } from "@/lib/payment-http";
import { listMyPaymentRequests } from "@/lib/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/payment/my
 * Query: ?status=PENDING|APPROVED|REJECTED&limit=1..100&cursor=…
 *
 * The member's own deposit claims, newest first — the screen that answers
 * "did my ₹500 land yet?".
 *
 * `userId` is pinned to the signed credential. The shared queue parser accepts a
 * `userId` filter because the admin screen needs one, and a member route that
 * forwarded it would turn this endpoint into a way to read other people's claims.
 * So the field is parsed and then dropped.
 */
async function handleGET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const query = parseListQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  const { status, limit, cursor } = query.data;

  try {
    const page = await listMyPaymentRequests(guard.userId, { status, limit, cursor });
    return apiJson({ ok: true, data: page }, 200);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// Each handler is wrapped: the payment mapper owns the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/payment/my", handleGET);
