import { apiGet } from "../lib/api";
import type { LedgerEntry, Page, WalletBalances } from "../types/api";

/**
 * The wallet and its ledger. Both are read-only here by design: a balance changes
 * only as the side effect of an approved claim or a payout request, and this app
 * never gets to write one directly.
 */

export function getWallet(): Promise<WalletBalances> {
  return apiGet<WalletBalances>("/api/wallet");
}

export type HistoryFilter = {
  limit?: number;
  cursor?: string | null;
};

/**
 * `GET /api/wallet/transactions` — keyset-paged, newest first.
 *
 * `limit` (1..100) and `cursor` are the only two parameters the server parses, so
 * they are the only two this client sends. Filtering by type happens on the device
 * if it is ever wanted; inventing a `?type=` here would be a feature that silently
 * does nothing, which is worse than not offering it.
 */
export function listTransactions(filter: HistoryFilter = {}): Promise<Page<LedgerEntry>> {
  const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
  if (filter.cursor) params.cursor = filter.cursor;
  return apiGet<Page<LedgerEntry>>("/api/wallet/transactions", { params });
}
