import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError } from "@/types";
import { apiJson, logApiError, parseQueueQuery } from "@/lib/http";
import { MAX_REFERENCE_LENGTH, MIN_REFERENCE_LENGTH } from "@/lib/bank-reference";
import { MAX_REVIEW_NOTE_LENGTH, MIN_REVIEW_NOTE_LENGTH } from "@/lib/review-note";
import { WalletError, type WalletErrorCode } from "@/lib/wallet";
import { WithdrawalError, type WithdrawalErrorCode } from "@/lib/withdrawal";

/* ==========================================================================
   HTTP LAYER FOR THE PAYOUT ENDPOINTS
   ==========================================================================

   Same shape as the deposit queue's HTTP layer, and for the same reason: a
   review can be refused by the payout state machine (`WithdrawalError`) or by
   the wallet service it delegates to (`WalletError`), and a client should not
   have to know which module said no.
   ========================================================================== */

export type WithdrawalApiError = {
  ok: false;
  error: string;
  code: WithdrawalErrorCode | WalletErrorCode | ApiError["code"];
  details?: unknown;
};

export function withdrawalErrorResponse(error: unknown): NextResponse {
  if (error instanceof WithdrawalError || error instanceof WalletError) {
    return apiJson(
      { ok: false, error: error.message, code: error.code } satisfies WithdrawalApiError,
      error.status,
    );
  }

  // Logged here, not left to `guardRoute`: this catch is what turns a bug into a
  // 500, so it is also the last place that still knows the error was thrown.
  logApiError("withdrawal", error);
  const body: WithdrawalApiError = {
    ok: false,
    error: "Something went wrong. Please try again.",
    code: "INTERNAL_ERROR",
  };
  return apiJson(body, 500);
}

/** Queue filters and paging are shared with the deposit queue. */
export const parseListQuery = parseQueueQuery;

/* ==========================================================================
   BODY PARSING
   ========================================================================== */

const createSchema = z
  .object({
    amount: z.number({ invalid_type_error: "amount must be a number" }),
    upiId: z.string().trim().min(3).max(320),
  })
  // Nothing else is accepted. `status`, `adminUtr` and a self-chosen amount of
  // tokens are all server-owned, and a member picking any of them is the bug
  // this line exists to stop.
  .strict();

const approveSchema = z
  .object({
    adminUtr: z
      .string()
      .trim()
      .min(MIN_REFERENCE_LENGTH)
      .max(MAX_REFERENCE_LENGTH)
      .nullish(),
  })
  .strict();

const rejectSchema = z
  .object({
    reviewNote: z
      .string()
      .trim()
      .min(MIN_REVIEW_NOTE_LENGTH)
      .max(MAX_REVIEW_NOTE_LENGTH),
  })
  .strict();

function validationFailed(details: unknown): NextResponse {
  const body: WithdrawalApiError = {
    ok: false,
    error: "Invalid request body",
    code: "VALIDATION_ERROR",
    details,
  };
  return apiJson(body, 400);
}

export type ParsedCreateBody =
  | { ok: true; data: { amount: number; upiId: string } }
  | { ok: false; response: NextResponse };

export function parseCreateBody(body: unknown): ParsedCreateBody {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, data: parsed.data };
}

export type ParsedApproveBody =
  | { ok: true; adminUtr: string | null | undefined }
  | { ok: false; response: NextResponse };

export function parseApproveBody(body: unknown): ParsedApproveBody {
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, adminUtr: parsed.data.adminUtr };
}

export type ParsedRejectBody =
  | { ok: true; reviewNote: string }
  | { ok: false; response: NextResponse };

export function parseRejectBody(body: unknown): ParsedRejectBody {
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationFailed(parsed.error.flatten()) };
  return { ok: true, reviewNote: parsed.data.reviewNote };
}
