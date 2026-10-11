import { formatIndian } from "./format";
import type { LedgerEntry, MatchStatus, PaymentStatus, WithdrawalStatus } from "../types/api";

/**
 * Every human label the app shows for a server-side enum value, in one file.
 *
 * Two reasons this lives apart from the screens: the wallet ledger and the payout
 * history describe the same movement and must not drift into two vocabularies, and
 * an unknown value has to be handled once. `LEDGER_LABELS[...] ?? type` renders the
 * raw constant, which is the right failure: a new type added on the backend shows
 * up as `WINNING_TAX` in the list, and a tester reports it, instead of the row
 * disappearing or reading "Adjustment" when it is not one.
 */

export const LEDGER_LABELS: Record<LedgerEntry["type"], string> = {
  DEPOSIT: "Deposit approved",
  WITHDRAWAL: "Withdrawal requested",
  WINNING: "Winnings",
  REFUND: "Withdrawal refunded",
  ADMIN_ADJUST: "Account adjustment",
};

export const BALANCE_LABELS: Record<LedgerEntry["balanceType"], string> = {
  DEPOSIT: "deposit balance",
  WINNING: "winning balance",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Waiting for review",
  APPROVED: "Credited",
  REJECTED: "Rejected",
};

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  PENDING: "In the payout queue",
  APPROVED: "Paid out",
  REJECTED: "Refunded",
};

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  UPCOMING: "Scheduled",
  LIVE: "Live",
  COMPLETED: "Completed",
};

export function ledgerLabel(type: string): string {
  return LEDGER_LABELS[type as LedgerEntry["type"]] ?? type;
}

/** `+1,250` / `−800`. The sign is stored by the server, never inferred here. */
export function signedAmount(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatIndian(Math.abs(amount))}`;
}
