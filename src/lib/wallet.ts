import { Prisma, type BalanceType, type TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "@/lib/pagination";

/* ==========================================================================
   WALLET SERVICE
   ==========================================================================

   Each member has one wallet with two balances, both in tokens:

     depositBalance  Increased only by approved payments (creditDeposit).
     winningBalance  Increased by winnings (creditWinning). Only this balance
                     can be debited, and only for withdrawals (debitWinning).

   Every change writes one Transaction (ledger) row in the same database
   transaction. The row stores the signed amount and the balance right after
   the change, so the ledger can be reconciled against the cached balances.

   Concurrency: each change first locks the member's wallet row with
   SELECT ... FOR UPDATE. Checks therefore see the current balance, and
   concurrent changes to one wallet run one after another.

   Composition: a caller that needs several writes to succeed or fail together
   (for example, approving a payment and crediting the deposit) passes its own
   transaction as `{ tx }`. The wallet function then joins that transaction and
   does not commit it. If a wallet function throws inside a caller's
   transaction, the caller must roll the transaction back.
   ========================================================================== */

/** Winning tokens that must stay in the wallet after any withdrawal debit. */
export const MIN_RETAINED_WINNING_TOKENS = 100;

/** Upper limit for any single balance. Stays inside PostgreSQL INTEGER. */
export const MAX_BALANCE = 2_000_000_000;

/* Page-size limits live in `src/lib/pagination.ts` and are re-exported here so
   the wallet HTTP layer and existing callers keep one import path. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

const MAX_REFERENCE_ID_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;

/** A money write waits up to 5 s for a pooled connection and up to 10 s overall. */
const WALLET_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/* ==========================================================================
   ERRORS
   ========================================================================== */

export type WalletErrorCode =
  | "VALIDATION_ERROR"
  | "WALLET_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_NOT_APPROVED"
  | "PAYMENT_MISMATCH"
  | "MINIMUM_BALANCE"
  | "BALANCE_LIMIT"
  | "DUPLICATE_REFERENCE"
  | "REFUND_NOT_MATCHED";

const HTTP_STATUS_BY_CODE: Record<WalletErrorCode, number> = {
  VALIDATION_ERROR: 400,
  WALLET_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_NOT_APPROVED: 422,
  PAYMENT_MISMATCH: 422,
  MINIMUM_BALANCE: 422,
  BALANCE_LIMIT: 422,
  DUPLICATE_REFERENCE: 409,
  REFUND_NOT_MATCHED: 422,
};

/** Expected business or validation failure. Routes map it to an HTTP response. */
export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly status: number;

  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
  }
}

/* ==========================================================================
   TYPES
   ========================================================================== */

export type WalletBalances = {
  depositBalance: number;
  winningBalance: number;
  /** depositBalance + winningBalance. */
  total: number;
  /** Winning tokens that can be withdrawn now while the minimum stays in place. */
  withdrawableBalance: number;
};

const LEDGER_SELECT = {
  id: true,
  type: true,
  amount: true,
  balanceType: true,
  balanceAfter: true,
  description: true,
  referenceId: true,
  createdAt: true,
} as const satisfies Prisma.TransactionSelect;

/** One ledger row. `amount` is signed: positive for credits, negative for debits. */
export type LedgerEntry = Prisma.TransactionGetPayload<{
  select: typeof LEDGER_SELECT;
}>;

export type WalletMutationResult = {
  balances: WalletBalances;
  entry: LedgerEntry;
};

export type TransactionPage = {
  items: LedgerEntry[];
  /** Pass as `cursor` to fetch the next, older page. Null on the last page. */
  nextCursor: string | null;
};

export type WalletWriteOptions = {
  /** Join this transaction instead of opening one. The caller commits or rolls back. */
  tx?: Prisma.TransactionClient;
};

type WalletRow = {
  id: string;
  userId: string;
  depositBalance: number;
  winningBalance: number;
};

type Movement = {
  type: TransactionType;
  balanceType: BalanceType;
  /** Signed change: positive credits the balance, negative debits it. */
  delta: number;
  referenceId: string | null;
  description: string | null;
};

/* ==========================================================================
   READS
   ========================================================================== */

/** The member's current balances. Throws WALLET_NOT_FOUND if the wallet is missing. */
export async function getWallet(userId: string): Promise<WalletBalances> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { depositBalance: true, winningBalance: true },
  });
  if (!wallet) throw walletNotFound();
  return toBalances(wallet);
}

/**
 * Ledger rows for a member, newest first. Pagination is keyset-based: the
 * cursor encodes the last row returned, so inserts during paging do not cause
 * skipped or repeated rows.
 */
export async function getTransactionHistory(
  userId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<TransactionPage> {
  const limit = resolveLimit(options.limit);
  if (limit === null) {
    throw new WalletError(
      "VALIDATION_ERROR",
      `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
    );
  }
  const after = options.cursor ? parseCursorOrThrow(options.cursor) : null;

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: LEDGER_SELECT,
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/* ==========================================================================
   WRITES
   ========================================================================== */

/**
 * Credits the deposit balance for an approved payment.
 *
 * `referenceId` is the PaymentRequest id and is required. The payment must
 * belong to this member, be APPROVED, and have `tokensToCredit === amount`.
 * Each payment can be credited once.
 */
export async function creditDeposit(
  userId: string,
  amount: number,
  referenceId: string,
  description?: string | null,
  options: WalletWriteOptions = {},
): Promise<WalletMutationResult> {
  const tokens = assertAmount(amount);
  const paymentId = parseReferenceId(referenceId);
  const note = normalizeDescription(description);

  return withWallet(userId, options, async (tx, wallet) => {
    await assertNotApplied(tx, userId, "DEPOSIT", paymentId);

    const payment = await tx.paymentRequest.findUnique({
      where: { id: paymentId },
      select: { userId: true, status: true, tokensToCredit: true },
    });
    if (!payment || payment.userId !== userId) {
      throw new WalletError(
        "PAYMENT_NOT_FOUND",
        "No payment request matches this reference for this member",
      );
    }
    if (payment.status !== "APPROVED") {
      throw new WalletError("PAYMENT_NOT_APPROVED", "The payment has not been approved");
    }
    if (payment.tokensToCredit !== tokens) {
      throw new WalletError(
        "PAYMENT_MISMATCH",
        "Amount does not match the tokens approved for this payment",
      );
    }

    return applyMovement(tx, wallet, {
      type: "DEPOSIT",
      balanceType: "DEPOSIT",
      delta: tokens,
      referenceId: paymentId,
      description: note,
    });
  });
}

/**
 * Credits winnings to the winning balance. This is the only way it grows.
 * Pass a reference (for example the match id) so the same award cannot be
 * applied twice.
 */
export async function creditWinning(
  userId: string,
  amount: number,
  referenceId?: string | null,
  description?: string | null,
  options: WalletWriteOptions = {},
): Promise<WalletMutationResult> {
  const tokens = assertAmount(amount);
  const reference = normalizeReferenceId(referenceId);
  const note = normalizeDescription(description);

  return withWallet(userId, options, async (tx, wallet) => {
    await assertNotApplied(tx, userId, "WINNING", reference);

    return applyMovement(tx, wallet, {
      type: "WINNING",
      balanceType: "WINNING",
      delta: tokens,
      referenceId: reference,
      description: note,
    });
  });
}

/**
 * Debits the winning balance for a withdrawal.
 *
 * Rule: winningBalance - amount must be at least MIN_RETAINED_WINNING_TOKENS,
 * so the minimum always stays in the wallet. An amount that would drop the
 * balance below the minimum, including one larger than the balance, fails
 * with MINIMUM_BALANCE. The deposit balance is never debited.
 */
export async function debitWinning(
  userId: string,
  amount: number,
  referenceId?: string | null,
  description?: string | null,
  options: WalletWriteOptions = {},
): Promise<WalletMutationResult> {
  const tokens = assertAmount(amount);
  const reference = normalizeReferenceId(referenceId);
  const note = normalizeDescription(description);

  return withWallet(userId, options, async (tx, wallet) => {
    await assertNotApplied(tx, userId, "WITHDRAWAL", reference);

    if (wallet.winningBalance - tokens < MIN_RETAINED_WINNING_TOKENS) {
      throw new WalletError("MINIMUM_BALANCE", minimumBalanceMessage());
    }

    return applyMovement(tx, wallet, {
      type: "WITHDRAWAL",
      balanceType: "WINNING",
      delta: -tokens,
      referenceId: reference,
      description: note,
    });
  });
}

/**
 * Returns tokens that `debitWinning` took, because the payout was refused.
 *
 * Two rules make a refund safe to expose to a reviewer:
 *
 *   1. There must be a WITHDRAWAL ledger row for the same reference. The
 *      platform gives back what it cut, so a refund can never mint tokens out
 *      of nothing, whatever the caller's `WithdrawalRequest` row claims.
 *   2. The amount must equal that debit exactly. A partial refund would leave
 *      the remainder cut with nothing to show for it, which is a support case,
 *      not a ledger write.
 *
 * The unique `(user, type, reference)` index means the same withdrawal can
 * also only ever be refunded once, and the credit lands in `winningBalance`,
 * never in the deposit balance.
 */
export async function refundWinning(
  userId: string,
  amount: number,
  referenceId: string,
  description?: string | null,
  options: WalletWriteOptions = {},
): Promise<WalletMutationResult> {
  const tokens = assertAmount(amount);
  const reference = parseReferenceId(referenceId);
  const note = normalizeDescription(description);

  return withWallet(userId, options, async (tx, wallet) => {
    await assertNotApplied(tx, userId, "REFUND", reference);

    const debit = await tx.transaction.findFirst({
      where: { userId, type: "WITHDRAWAL", referenceId: reference },
      select: { amount: true },
    });
    if (!debit) {
      throw new WalletError(
        "REFUND_NOT_MATCHED",
        "No withdrawal debit exists for this reference, so nothing can be returned",
      );
    }
    if (-debit.amount !== tokens) {
      throw new WalletError(
        "REFUND_NOT_MATCHED",
        `That withdrawal cut ${-debit.amount} tokens, so only ${-debit.amount} can be returned`,
      );
    }

    return applyMovement(tx, wallet, {
      type: "REFUND",
      balanceType: "WINNING",
      delta: tokens,
      referenceId: reference,
      description: note,
    });
  });
}

/* ==========================================================================
   INTERNALS
   ========================================================================== */

/**
 * Runs `work` with the member's wallet row locked. Joins the caller's
 * transaction when one is passed. Otherwise it opens its own.
 */
async function withWallet<T>(
  userId: string,
  options: WalletWriteOptions,
  work: (tx: Prisma.TransactionClient, wallet: WalletRow) => Promise<T>,
): Promise<T> {
  const run = async (tx: Prisma.TransactionClient) => {
    const wallet = await lockWallet(tx, userId);
    return work(tx, wallet);
  };

  return options.tx ? run(options.tx) : prisma.$transaction(run, WALLET_TX_OPTIONS);
}

/** SELECT ... FOR UPDATE on the wallet row. Blocks other writers until commit. */
async function lockWallet(tx: Prisma.TransactionClient, userId: string): Promise<WalletRow> {
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT "id",
           "user_id"         AS "userId",
           "deposit_balance" AS "depositBalance",
           "winning_balance" AS "winningBalance"
    FROM "wallets"
    WHERE "user_id" = ${userId}
    FOR UPDATE
  `;

  const wallet = rows[0];
  if (!wallet) throw walletNotFound();
  return wallet;
}

/**
 * Updates the balance and writes the ledger row. The caller must already hold
 * the wallet lock and have run every rule check.
 */
async function applyMovement(
  tx: Prisma.TransactionClient,
  wallet: WalletRow,
  movement: Movement,
): Promise<WalletMutationResult> {
  const current =
    movement.balanceType === "DEPOSIT" ? wallet.depositBalance : wallet.winningBalance;

  /*
   * The two balance rules, enforced at the one place every movement passes
   * through, not only in the caller that remembers them:
   *
   *   • the retained minimum — at least MIN_RETAINED_WINNING_TOKENS must stay in
   *     the winning balance after any debit (`debitWinning` checks this too, and
   *     gets the identical error, so nothing changes for it);
   *   • deposits are never debited. An approved deposit is already spent or banked
   *     on the member's side, and a reversal path is an open design decision
   *     (docs/SYSTEM_DESIGN.md §5.5), not something to improvise at the ledger.
   *
   * Putting them here is what makes "enforced everywhere" true for the next
   * caller — a prediction stake, an admin correction — rather than only for the
   * two that exist today.
   */
  if (movement.delta < 0) {
    if (movement.balanceType === "DEPOSIT") {
      throw new WalletError(
        "VALIDATION_ERROR",
        "A deposit balance is never debited. Refunds of winnings go through the winning balance.",
      );
    }
    if (current + movement.delta < MIN_RETAINED_WINNING_TOKENS) {
      throw new WalletError("MINIMUM_BALANCE", minimumBalanceMessage());
    }
  }

  if (current + movement.delta > MAX_BALANCE) {
    throw new WalletError(
      "BALANCE_LIMIT",
      `This change would take the balance above ${MAX_BALANCE} tokens`,
    );
  }

  const balances = await tx.wallet.update({
    where: { id: wallet.id },
    data:
      movement.balanceType === "DEPOSIT"
        ? { depositBalance: { increment: movement.delta } }
        : { winningBalance: { increment: movement.delta } },
    select: { depositBalance: true, winningBalance: true },
  });

  const balanceAfter =
    movement.balanceType === "DEPOSIT" ? balances.depositBalance : balances.winningBalance;

  try {
    const entry = await tx.transaction.create({
      data: {
        userId: wallet.userId,
        type: movement.type,
        amount: movement.delta,
        balanceType: movement.balanceType,
        balanceAfter,
        description: movement.description,
        referenceId: movement.referenceId,
      },
      select: LEDGER_SELECT,
    });
    return { balances: toBalances(balances), entry };
  } catch (error) {
    // Backstop for the unique (user, type, reference) index. The pre-check in
    // assertNotApplied normally catches duplicates first.
    if (isUniqueViolation(error)) throw alreadyApplied();
    throw error;
  }
}

/** Rejects a second write with the same reference and type. */
async function assertNotApplied(
  tx: Prisma.TransactionClient,
  userId: string,
  type: TransactionType,
  referenceId: string | null,
): Promise<void> {
  if (referenceId === null) return;

  const existing = await tx.transaction.findFirst({
    where: { userId, type, referenceId },
    select: { id: true },
  });
  if (existing) throw alreadyApplied();
}

function toBalances(wallet: { depositBalance: number; winningBalance: number }): WalletBalances {
  return {
    depositBalance: wallet.depositBalance,
    winningBalance: wallet.winningBalance,
    total: wallet.depositBalance + wallet.winningBalance,
    withdrawableBalance: Math.max(0, wallet.winningBalance - MIN_RETAINED_WINNING_TOKENS),
  };
}

/* ==========================================================================
   VALIDATION AND CURSORS
   ========================================================================== */

function assertAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_BALANCE) {
    throw new WalletError(
      "VALIDATION_ERROR",
      `Amount must be a whole number of tokens from 1 to ${MAX_BALANCE}`,
    );
  }
  return amount;
}

/** Optional reference. null or undefined means no reference. */
function normalizeReferenceId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return parseReferenceId(value);
}

/** Required reference (deposits). Same rules as above, except a value is mandatory. */
function parseReferenceId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REFERENCE_ID_LENGTH) {
    throw new WalletError(
      "VALIDATION_ERROR",
      `referenceId must be 1 to ${MAX_REFERENCE_ID_LENGTH} characters`,
    );
  }
  return trimmed;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = value.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new WalletError(
      "VALIDATION_ERROR",
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}


/* ==========================================================================
   SMALL HELPERS
   ========================================================================== */

/** Cursor format is shared with the payment queue. Only the error type differs. */
function parseCursorOrThrow(cursor: string): { createdAt: Date; id: string } {
  const position = decodeCursor(cursor);
  if (!position) throw new WalletError("VALIDATION_ERROR", "cursor is not valid");
  return position;
}

function walletNotFound(): WalletError {
  return new WalletError("WALLET_NOT_FOUND", "Wallet not found");
}

function alreadyApplied(): WalletError {
  return new WalletError(
    "DUPLICATE_REFERENCE",
    "This reference has already been applied to the wallet",
  );
}

export function minimumBalanceMessage(): string {
  return `Minimum ${MIN_RETAINED_WINNING_TOKENS} tokens must remain in wallet`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
