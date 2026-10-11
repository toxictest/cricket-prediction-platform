import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { listPaymentRequests } from "@/lib/payment";
import { parseListQuery, paymentErrorResponse } from "@/lib/payment-http";
import { guardRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only payment reviewers and Super Admins. SUPER_ADMIN is not an implicit pass, so it is listed. */
const PAYMENT_REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/**
 * GET /api/admin/payments?status=PENDING&limit=20&cursor=...&userId=...
 *
 * The review queue, newest first, keyset-paged. `counts` reports the whole
 * filtered queue, not just this page, so the header of each tab is honest.
 * Each row carries the member who filed the claim and the admin who reviewed it.
 *
 * This read is available even when `MONEY_MODE` is off: an admin must always be
 * able to look at what was filed. Only the review actions are gated.
 */
async function handleGET(request: NextRequest) {
  const guard = await requireAdmin(PAYMENT_REVIEW_ROLES);
  if (!guard.ok) return guard.response;

  const query = parseListQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  try {
    const page = await listPaymentRequests(query.data);
    return adminJson({ ok: true, data: page }, 200);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/admin/payments", handleGET);
