import { NextResponse } from "next/server";
import { z } from "zod";
import { apiJson } from "@/lib/http";
import type { ApiError } from "@/types";
import { MAX_PAGE_SIZE, WalletError, type WalletErrorCode } from "@/lib/wallet";

/* ==========================================================================
   HTTP HELPERS FOR WALLET ROUTES
   ========================================================================== */

/** Error envelope. Domain codes come from the wallet service. Generic codes come from the shared ApiError type. */
export type WalletApiError = {
  ok: false;
  error: string;
  code: WalletErrorCode | ApiError["code"];
  details?: unknown;
};

/** Maps a service or unexpected error to a response. Unknown errors are logged and become a 500. */
export function walletErrorResponse(error: unknown): NextResponse {
  if (error instanceof WalletError) {
    const body: WalletApiError = { ok: false, error: error.message, code: error.code };
    return apiJson(body, error.status);
  }

  console.error("[wallet] unexpected error:", error);
  const body: WalletApiError = {
    ok: false,
    error: "Something went wrong. Please try again.",
    code: "INTERNAL_ERROR",
  };
  return apiJson(body, 500);
}

/* ==========================================================================
   QUERY VALIDATION
   ========================================================================== */

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** Parses `?limit=&cursor=`. Returns a 400 response when the query is invalid. */
export function parseHistoryQuery(
  params: URLSearchParams,
): { ok: true; data: HistoryQuery } | { ok: false; response: NextResponse } {
  const parsed = historyQuerySchema.safeParse({
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });

  if (!parsed.success) {
    const body: WalletApiError = {
      ok: false,
      error: "Invalid query parameters",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    };
    return { ok: false, response: apiJson(body, 400) };
  }

  return { ok: true, data: parsed.data };
}
