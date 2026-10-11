import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError } from "@/types";
import { apiJson, logApiError, parseQueueQuery, type QueueQuery } from "@/lib/http";
import { WalletError, type WalletErrorCode } from "@/lib/wallet";
import {
  MAX_REVIEW_NOTE_LENGTH,
  MIN_REVIEW_NOTE_LENGTH,
  PaymentError,
  type PaymentErrorCode,
} from "@/lib/payment";

/* ==========================================================================
   HTTP LAYER FOR THE PAYMENT ENDPOINTS
   ==========================================================================

   Query and body parsing, plus one error mapper that knows about both domain
   error classes: a review endpoint can fail with a PaymentError (bad state) or
   with a WalletError (the credit itself was refused), and the member and admin
   clients need the same envelope either way.
   ========================================================================== */

/**
 * One envelope for both failure sources. A review can be refused by the payment
 * state machine (`PaymentError`) or by the wallet service it delegates to
 * (`WalletError`), and clients branch on `code` without caring which module
 * raised it.
 */
export type PaymentApiError = {
  ok: false;
  error: string;
  code: PaymentErrorCode | WalletErrorCode | ApiError["code"];
  details?: unknown;
};

/** Maps an expected failure to a response. Anything unexpected is logged and becomes a 500. */
export function paymentErrorResponse(error: unknown): NextResponse {
  if (error instanceof PaymentError || error instanceof WalletError) {
    return apiJson(
      { ok: false, error: error.message, code: error.code } satisfies PaymentApiError,
      error.status,
    );
  }

  // Logged here, not left to `guardRoute`: this catch is what turns a bug into a
  // 500, so it is also the last place that still knows the error was thrown.
  logApiError("payment", error);
  const body: PaymentApiError = {
    ok: false,
    error: "Something went wrong. Please try again.",
    code: "INTERNAL_ERROR",
  };
  return apiJson(body, 500);
}

/* ==========================================================================
   QUERY PARSING — GET /api/admin/payments
   ==========================================================================

   The parser itself is shared with the payout queue (`parseQueueQuery` in
   `src/lib/http.ts`); this wrapper only keeps the payment-facing name and type.
   ========================================================================== */

export type PaymentListQuery = QueueQuery;

export const parseListQuery = parseQueueQuery;

/* ==========================================================================
   BODY PARSING
   ========================================================================== */

const createSchema = z
  .object({
    amount: z.number({ invalid_type_error: "amount must be a number" }),
    utrNumber: z.string().min(1).max(64),
    screenshotUrl: z.string().min(1).max(2048),
  })
  // An unexpected `tokensToCredit` in the body is rejected rather than ignored:
  // the server owns the rupee-to-token conversion.
  .strict();

const reviewSchema = z
  .object({ reviewNote: z
      .string()
      .trim()
      .min(MIN_REVIEW_NOTE_LENGTH)
      .max(MAX_REVIEW_NOTE_LENGTH)
      .optional() })
  .strict();

const rejectSchema = z
  .object({ reviewNote: z
      .string()
      .trim()
      .min(MIN_REVIEW_NOTE_LENGTH)
      .max(MAX_REVIEW_NOTE_LENGTH) })
  .strict();

function validationFailed(details: unknown): NextResponse {
  const body: PaymentApiError = {
    ok: false,
    error: "Invalid request body",
    code: "VALIDATION_ERROR",
    details,
  };
  return apiJson(body, 400);
}

export type ParsedCreateBody =
  | { ok: true; data: z.infer<typeof createSchema> }
  | { ok: false; response: NextResponse };

export function parseCreateBody(body: unknown): ParsedCreateBody {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, data: parsed.data };
}

export type ParsedApproveBody =
  | { ok: true; reviewNote: string | null }
  | { ok: false; response: NextResponse };

/** Approve takes no fields. An optional note is allowed for "verified in the statement". */
export function parseApproveBody(body: unknown): ParsedApproveBody {
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, reviewNote: parsed.data.reviewNote ?? null };
}

export type ParsedRejectBody =
  | { ok: true; reviewNote: string }
  | { ok: false; response: NextResponse };

export function parseRejectBody(body: unknown): ParsedRejectBody {
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, reviewNote: parsed.data.reviewNote };
}
