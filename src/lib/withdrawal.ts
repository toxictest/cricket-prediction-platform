import { Prisma, type WithdrawalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MONEY_MODE_OFF_MESSAGE, moneyModeEnabled } from "@/lib/feature-flags";
import {
  MAX_BALANCE,
  MIN_RETAINED_WINNING_TOKENS,
  debitWinning,
  refundWinning,
  type LedgerEntry,
  type WalletBalances,
} from "@/lib/wallet";
import {
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "@/lib/pagination";
import {
  canonicalizeReference,
  isWellFormedReference,
  referenceShapeMessage,
} from "@/lib/bank-reference";
import {
  MAX_REVIEW_NOTE_LENGTH,
  MIN_REVIEW_NOTE_LENGTH,
  trimReviewNote,
} from "@/lib/review-note";

/* ==========================================================================
   WITHDRAWAL SERVICE — PAYOUTS OF WINNINGS
   ==========================================================================

   A member asks for winnings to be sent to a UPI ID. The platform cuts the
   tokens when the request is filed and pays outside the app; a PAYMENT_ADMIN
   or SUPER_ADMIN confirms the payout, or refuses the request.

   The cut happens first, and that ordering is the whole design:

     request  → winningBalance goes down, a WITHDRAWAL ledger row is written,
                and a PENDING row records the promise to pay.
     approve  → the promise is marked kept. No balance change, because the
                tokens left at request time. A duplicate approval can therefore
                never pay twice.
     reject   → the tokens come back through refundWinning, as a REFUND ledger
                row, and the request stops being pending.

   Holding the balance from the start means the platform can never overpay: the
   money is already gone from the wallet, so a queue that sits for a day cannot
   drain a member dry or leave the operator short. The cost is that a rejected
   request must refund, so the refund path is as guarded as the debit.

   Rules this module owns
   ----------------------
   1. Only `winningBalance` can be withdrawn. A deposit balance is not
      withdrawable, and `debitWinning` is the only function that moves it.
   2. At least MIN_RETAINED_WINNING_TOKENS (100) stay in the wallet afterwards.
   3. The row is created and the balance is cut in one transaction. Either the
      member has a PENDING request and no tokens, or they have their tokens and
      no request. An orphan claim that could later be "approved" is not possible.
   4. Only a PENDING request can be reviewed. Every review is a conditional
      update that must match exactly one row, and the request row is locked
      first, so two admins cannot both act on it.
   5. A refund can only return what the matching WITHDRAWAL ledger row removed,
      and only once. So a tampered `amount` on the request row cannot mint
      tokens; the rejection fails and the request stays PENDING.
   6. Filing, approving and rejecting are gated on `MONEY_MODE`
      (docs/SYSTEM_DESIGN.md §2, rule G1). Reading either list is not: a member
      must always be able to see what happened to their request, and an admin
      must always be able to see the queue.
   ========================================================================== */

/** A member may not stack unbounded payout requests, each of which is a real transfer to make. */
export const MAX_PENDING_PER_MEMBER = 5;

/** VPA local part and handle bounds, per the UPI naming rules this app accepts. */
const MIN_UPI_LOCAL_LENGTH = 2;
const MIN_UPI_HANDLE_LENGTH = 2; // "a@b" is meaningless; the shortest accepted is "ab@cd"
const MAX_UPI_LOCAL_LENGTH = 256;
const MAX_UPI_HANDLE_LENGTH = 64;
const MAX_UPI_ID_LENGTH = 320;

const MAX_ID_LENGTH = 64;

/** A money write waits up to 5 s for a pooled connection and up to 10 s overall. */
const WITHDRAWAL_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/* ==========================================================================
   ERRORS
   ========================================================================== */

export type WithdrawalErrorCode =
  | "VALIDATION_ERROR"
  | "PAYMENTS_DISABLED"
  | "WITHDRAWAL_NOT_FOUND"
  | "NOT_PENDING"
  | "TOO_MANY_PENDING";

const HTTP_STATUS_BY_CODE: Record<WithdrawalErrorCode, number> = {
  VALIDATION_ERROR: 400,
  PAYMENTS_DISABLED: 503,
  WITHDRAWAL_NOT_FOUND: 404,
  NOT_PENDING: 409,
  TOO_MANY_PENDING: 429,
};

/** Expected business or validation failure. Routes map it, together with WalletError, to a response. */
export class WithdrawalError extends Error {
  readonly code: WithdrawalErrorCode;
  readonly status: number;

  constructor(code: WithdrawalErrorCode, message: string) {
    super(message);
    this.name = "WithdrawalError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
  }
}

/* ==========================================================================
   TYPES
   ========================================================================== */

export type NewWithdrawalRequest = {
  amount: number;
  upiId: string;
};

/** What the member gets back: the request, and the wallet the cut already happened to. */
export type WithdrawalReceipt = {
  id: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  createdAt: Date;
  wallet: WalletBalances;
  transaction: LedgerEntry;
};

/** The member's own view of a request. No admin columns beyond the payout reference. */
export type MyWithdrawalItem = {
  id: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  reviewNote: string | null;
  adminUtr: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The queue view: the request, whose it is, and who reviewed it. */
export type WithdrawalQueueItem = MyWithdrawalItem & {
  user: { id: string; name: string; email: string; referralCode: string };
  reviewedBy: { id: string; name: string; email: string } | null;
};

export type WithdrawalPage<T> = {
  items: T[];
  /** Pass as `cursor` for the next, older page. Null on the last page. */
  nextCursor: string | null;
};

export type WithdrawalQueuePage = WithdrawalPage<WithdrawalQueueItem> & {
  /** Whole-queue totals for the tab labels, independent of the current page or filter. */
  counts: { PENDING: number; APPROVED: number; REJECTED: number };
};

export type WithdrawalReviewResult = {
  withdrawal: WithdrawalQueueItem;
  /** Present on a rejection: the balances after the refund and the REFUND row written. */
  wallet?: WalletBalances;
  transaction?: LedgerEntry;
};

const MY_SELECT = {
  id: true,
  amount: true,
  upiId: true,
  status: true,
  reviewNote: true,
  adminUtr: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.WithdrawalRequestSelect;

const QUEUE_SELECT = {
  ...MY_SELECT,
  user: { select: { id: true, name: true, email: true, referralCode: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.WithdrawalRequestSelect;

/* ==========================================================================
   MEMBER: ASK FOR A PAYOUT
   ========================================================================== */

/**
 * Cuts the winning balance and files the request, in one transaction.
 *
 * `debitWinning` is the only thing that touches a balance here, so the two rules
 * a payout has to obey are enforced where every other wallet movement is
 * enforced: only winnings may leave, and at least
 * MIN_RETAINED_WINNING_TOKENS must remain.
 *
 * Throws MINIMUM_BALANCE (422) with "Minimum 100 tokens must remain in wallet"
 * when the amount would break that rule, including when it is simply larger
 * than the balance. The request row is rolled back with it, so nothing is
 * left pending.
 *
 * Throws TOO_MANY_PENDING (429) past MAX_PENDING_PER_MEMBER open requests.
 */
export async function createWithdrawalRequest(
  userId: string,
  input: NewWithdrawalRequest,
): Promise<WithdrawalReceipt> {
  requireMoneyMode();

  const amount = assertAmount(input.amount);
  const upiId = normalizeUpiId(input.upiId);

  // Advisory, like the deposit queue: the cap protects the operator's worklist,
  // and the balance is the real limit on what a member can take out.
  const pending = await prisma.withdrawalRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_MEMBER) {
    throw new WithdrawalError(
      "TOO_MANY_PENDING",
      `You already have ${MAX_PENDING_PER_MEMBER} payouts waiting. Wait for one to be processed.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.withdrawalRequest.create({
      data: { userId, amount, upiId, status: "PENDING" },
      select: { id: true, amount: true, upiId: true, status: true, createdAt: true },
    });

    // The request id is the ledger reference, so this debit can never be
    // applied twice for the same request even if the caller retries.
    const debit = await debitWinning(
      userId,
      request.amount,
      request.id,
      `Withdrawal requested to ${request.upiId}`,
      { tx },
    );

    return { ...request, wallet: debit.balances, transaction: debit.entry };
  }, WITHDRAWAL_TX_OPTIONS);
}

/* ==========================================================================
   READS
   ========================================================================== */

export type WithdrawalListFilters = {
  status?: WithdrawalStatus;
  userId?: string;
  limit?: number;
  cursor?: string | null;
};

/**
 * The member's own payouts, newest first, keyset-paged. Deliberately a separate
 * projection from the admin queue: it has no reviewer identity in it, because a
 * reviewer's name is not something a member needs to see.
 *
 * `userId` always comes from the session, never from the query string, which is
 * why the member route can reuse the queue's `?status=` parameter safely.
 */
export async function listMyWithdrawals(
  userId: string,
  filters: { status?: WithdrawalStatus; limit?: number; cursor?: string | null } = {},
): Promise<WithdrawalPage<MyWithdrawalItem>> {
  const { limit, after } = resolvePage(filters);

  const rows = await prisma.withdrawalRequest.findMany({
    where: { userId, ...(filters.status ? { status: filters.status } : {}), ...olderThan(after) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: MY_SELECT,
  });

  return pageOf(rows, limit);
}

/**
 * The review queue, newest first. `counts` covers the whole filtered queue
 * rather than the page, so the tab labels of the admin UI are honest.
 */
export async function listWithdrawalRequests(
  filters: WithdrawalListFilters = {},
): Promise<WithdrawalQueuePage> {
  const { limit, after } = resolvePage(filters);
  const where: Prisma.WithdrawalRequestWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...olderThan(after),
  };

  const [rows, totals] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: QUEUE_SELECT,
    }),
    prisma.withdrawalRequest.groupBy({
      by: ["status"],
      where: filters.userId ? { userId: filters.userId } : {},
      _count: { _all: true },
    }),
  ]);

  const { items, nextCursor } = pageOf(rows, limit);
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const row of totals) counts[row.status] = row._count._all;

  return { items, nextCursor, counts };
}

/* ==========================================================================
   ADMIN: CONFIRM THE PAYOUT
   ========================================================================== */

/**
 * Marks the request paid. No wallet write: the tokens left the balance when the
 * request was filed, so there is nothing to debit here, and approving twice
 * cannot pay twice.
 *
 * `adminUtr` is the reference of the outgoing transfer. It is optional, because
 * some UPI apps show no reference for a P2P payout, but the reviewer who
 * supplies one gets it on the row for the member to read.
 */
export async function approveWithdrawalRequest(
  requestId: string,
  adminId: string,
  adminUtr?: string | null,
): Promise<WithdrawalReviewResult> {
  requireMoneyMode();

  const id = parseId(requestId);
  const reviewerId = parseId(adminId, "admin id");
  const reference = adminUtr === undefined || adminUtr === null ? null : normalizeReference(adminUtr);

  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!request) throw notFound();
    if (request.status !== "PENDING") throw alreadyReviewed(request.status);

    const updated = await tx.withdrawalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: reviewerId, adminUtr: reference },
    });
    if (updated.count !== 1) {
      throw new WithdrawalError(
        "NOT_PENDING",
        "Another reviewer changed this request first. Reload the queue.",
      );
    }

    const withdrawal = await tx.withdrawalRequest.findUnique({
      where: { id },
      select: QUEUE_SELECT,
    });
    if (!withdrawal) throw notFound();

    return { withdrawal };
  }, WITHDRAWAL_TX_OPTIONS);
}

/* ==========================================================================
   ADMIN: REFUSE THE PAYOUT
   ========================================================================== */

/**
 * Refuses a request and returns the tokens.
 *
 *   lock the request → it must be PENDING → status REJECTED with the note
 *   → refundWinning(…), which credits the balance and writes the REFUND row
 *
 * Both halves are in one transaction, so there is no state where the member's
 * request is refused but the tokens are still held, and no state where the
 * tokens came back while the request is still open.
 *
 * `refundWinning` matches the refund against the original WITHDRAWAL ledger row
 * and refuses anything else: the amount must be exactly what that debit took,
 * and the same request can only ever be refunded once. So if the row is
 * inconsistent with its own debit — edited, or half-written by something outside
 * this service — the refund throws, the status update rolls back, and a human
 * looks at it instead of the ledger quietly growing.
 */
export async function rejectWithdrawalRequest(
  requestId: string,
  adminId: string,
  reviewNote: string,
): Promise<WithdrawalReviewResult> {
  requireMoneyMode();

  const id = parseId(requestId);
  const reviewerId = parseId(adminId, "admin id");
  const note = normalizeReviewNote(reviewNote);

  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!request) throw notFound();
    if (request.status !== "PENDING") throw alreadyReviewed(request.status);

    const updated = await tx.withdrawalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: reviewerId, reviewNote: note },
    });
    if (updated.count !== 1) {
      throw new WithdrawalError(
        "NOT_PENDING",
        "Another reviewer changed this request first. Reload the queue.",
      );
    }

    const refund = await refundWinning(
      request.userId,
      request.amount,
      id,
      `Withdrawal refused: ${note}`,
      { tx },
    );

    const withdrawal = await tx.withdrawalRequest.findUnique({
      where: { id },
      select: QUEUE_SELECT,
    });
    if (!withdrawal) throw notFound();

    return {
      withdrawal,
      wallet: refund.balances,
      transaction: refund.entry,
    };
  }, WITHDRAWAL_TX_OPTIONS);
}

/* ==========================================================================
   INTERNALS
   ========================================================================== */

function requireMoneyMode(): void {
  if (!moneyModeEnabled()) {
    throw new WithdrawalError("PAYMENTS_DISABLED", MONEY_MODE_OFF_MESSAGE);
  }
}

/**
 * Reads one request under a row lock, so a second reviewer waits instead of
 * acting on a stale read, and so the status, the member and the amount used for
 * the refund all come from the same instant.
 */
async function lockRequest(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedRequest | null> {
  const rows = await tx.$queryRaw<LockedRequest[]>`
    SELECT "id",
           "user_id"      AS "userId",
           "amount",
           "status"::text AS "status"
    FROM "withdrawal_requests"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

type LockedRequest = {
  id: string;
  userId: string;
  amount: number;
  status: string;
};

function resolvePage(filters: { limit?: number; cursor?: string | null }) {
  const limit = resolveLimit(filters.limit);
  if (limit === null) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
    );
  }
  if (filters.cursor === undefined || filters.cursor === null) {
    return { limit, after: null as { createdAt: Date; id: string } | null };
  }
  const after = decodeCursor(filters.cursor);
  if (!after) throw new WithdrawalError("VALIDATION_ERROR", "cursor is not valid");
  return { limit, after };
}

function olderThan(after: { createdAt: Date; id: string } | null): Prisma.WithdrawalRequestWhereInput {
  if (!after) return {};
  return {
    OR: [
      { createdAt: { lt: after.createdAt } },
      { createdAt: after.createdAt, id: { lt: after.id } },
    ],
  };
}

function pageOf<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

function notFound(): WithdrawalError {
  return new WithdrawalError("WITHDRAWAL_NOT_FOUND", "Withdrawal request not found");
}

function alreadyReviewed(status: string): WithdrawalError {
  return new WithdrawalError(
    "NOT_PENDING",
    `Only a PENDING request can be reviewed. This one is ${status}.`,
  );
}

/* ==========================================================================
   VALIDATION
   ========================================================================== */

/**
 * Whole tokens, above zero, and never past the limit a balance itself may hold.
 * The wallet's own ceiling is the only upper bound here on purpose: the member's
 * balance is what really limits a payout, and a second, smaller cap would be a
 * number nobody can explain to a member with 5,000 tokens waiting.
 */
export function assertAmount(amount: number): number {
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_BALANCE
  ) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `amount must be a whole number of tokens from 1 to ${MAX_BALANCE}`,
    );
  }
  return amount;
}

/**
 * A VPA is `localpart@handle`, case-insensitive, so it is stored lower-cased.
 * Getting this string exactly right matters more than most validation: it is
 * the destination of a real transfer, and a typo pays a stranger.
 */
export function normalizeUpiId(value: string): string {
  if (typeof value !== "string") {
    throw new WithdrawalError("VALIDATION_ERROR", "upiId must be a string");
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_UPI_ID_LENGTH) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `upiId must be 1 to ${MAX_UPI_ID_LENGTH} characters`,
    );
  }

  const parts = trimmed.split("@");
  if (parts.length !== 2) {
    throw new WithdrawalError("VALIDATION_ERROR", "upiId must look like name@bank");
  }

  const [local, handle] = parts;
  if (local.length < MIN_UPI_LOCAL_LENGTH || local.length > MAX_UPI_LOCAL_LENGTH) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `the part before @ must be 2 to ${MAX_UPI_LOCAL_LENGTH} characters`,
    );
  }
  if (handle.length < MIN_UPI_HANDLE_LENGTH || handle.length > MAX_UPI_HANDLE_LENGTH) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `the bank handle must be ${MIN_UPI_HANDLE_LENGTH} to ${MAX_UPI_HANDLE_LENGTH} characters`,
    );
  }
  if (!/^[a-z0-9._-]+$/.test(local)) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      "the part before @ may contain letters, digits, dot, underscore and hyphen",
    );
  }
  // A handle is a bank's own short code, so it is letters only. Digits there are
  // nearly always someone typing a phone number as the bank.
  if (!/^[a-z]+$/.test(handle)) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      "the bank handle after @ may contain letters only",
    );
  }

  return trimmed;
}

/** Payout reference recorded by the admin. Same shape rules as an inbound UTR. */
export function normalizeReference(value: string): string {
  if (typeof value !== "string") {
    throw new WithdrawalError("VALIDATION_ERROR", "adminUtr must be a string");
  }
  const normalized = canonicalizeReference(value);
  if (!isWellFormedReference(normalized)) {
    throw new WithdrawalError("VALIDATION_ERROR", referenceShapeMessage("adminUtr"));
  }
  return normalized;
}

export function normalizeReviewNote(value: string): string {
  if (typeof value !== "string") {
    throw new WithdrawalError("VALIDATION_ERROR", "reviewNote must be a string");
  }
  const trimmed = trimReviewNote(value);
  if (trimmed.length < MIN_REVIEW_NOTE_LENGTH) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `reviewNote must be at least ${MIN_REVIEW_NOTE_LENGTH} characters, so the member knows what to fix`,
    );
  }
  if (trimmed.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new WithdrawalError(
      "VALIDATION_ERROR",
      `reviewNote must be at most ${MAX_REVIEW_NOTE_LENGTH} characters`,
    );
  }
  return trimmed;
}

function parseId(value: string, label = "request id"): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new WithdrawalError("VALIDATION_ERROR", `${label} must be 1 to ${MAX_ID_LENGTH} characters`);
  }
  return trimmed;
}

/** Re-exported so a client-facing screen can quote the same 100 the service enforces. */
export { MIN_RETAINED_WINNING_TOKENS };
