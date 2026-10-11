import { apiGet, apiPost } from "../lib/api";
import type { MyWithdrawalItem, Page, WithdrawalReceipt, WithdrawalStatus } from "../types/api";

/*
 * Payouts. Filing this debits the winning balance *immediately* — the tokens leave
 * the wallet when the request is filed, not when an admin approves it — which is
 * why the app must say so before the member taps the button, and why a rejection
 * arrives as a refund rather than as "nothing happened".
 */

export function createWithdrawalRequest(input: { amount: number; upiId: string }): Promise<WithdrawalReceipt> {
  return apiPost<WithdrawalReceipt>("/api/withdrawal/request", input);
}

export function listMyWithdrawals(filter: { status?: WithdrawalStatus; limit?: number; cursor?: string | null } = {}): Promise<Page<MyWithdrawalItem>> {
  const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
  if (filter.status) params.status = filter.status;
  if (filter.cursor) params.cursor = filter.cursor;
  return apiGet<Page<MyWithdrawalItem>>("/api/withdrawal/my", { params });
}

/**
 * The retained floor. The server owns this number (MIN_RETAINED_WINNING_TOKENS in
 * src/lib/wallet.ts) and enforces it in the writer, so the app's copy is only
 * ever a *preview* of the answer it will get — the request is still rejected by
 * the server, and the app must show that rejection's message when it arrives.
 */
export { MINIMUM_BALANCE_MESSAGE, MIN_RETAINED_TOKENS } from "../utils/validation";
