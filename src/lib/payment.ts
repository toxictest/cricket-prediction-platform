import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MAX_REVIEW_NOTE_LENGTH,
  MIN_REVIEW_NOTE_LENGTH,
} from "@/lib/review-note";
import {
  externalUrlMessage,
  inspectExternalUrl,
} from "@/lib/external-url";
import {
  canonicalizeReference,
  isWellFormedReference,
  referenceShapeMessage,
} from "@/lib/bank-reference";
import { moneyModeEnabled, MONEY_MODE_OFF_MESSAGE } from "@/lib/feature-flags";
import { creditDeposit, type LedgerEntry, type WalletBalances } from "@/lib/wallet";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "@/lib/pagination";

/* ==========================================================================
   PAYMENT SERVICE — "ADD MONEY" VIA UPI QR
   ==========================================================================

   A member reads the platform's UPI QR (`getActivePaymentQr`), pays from any
   UPI app, then files a claim carrying the UTR (the bank's unique transaction
   reference) and a link to the payment screenshot. A PAYMENT_ADMIN or
   SUPER_ADMIN opens the queue, checks the bank statement, and either approves
   or rejects. Approval is the only place in the product where deposit balance
   is created, and it goes through the wallet service, so it always writes a
   ledger row next to the balance change.

   Rules this module owns
   ----------------------
   1. One UTR backs at most one claim, forever. The database unique index is
      the authority; the pre-check exists only to produce a friendly message.
   2. Only a PENDING claim can be approved or rejected. Every review is a
      conditional update that must match exactly one row, so two admins clicking
      approve cannot double-credit — the loser gets 409.
   3. `tokensToCredit` is computed by the server from `amount`. A client that
      sends it is rejected. 1 rupee = 1 token for now, in one named constant.
   4. Approval runs in one interactive transaction: lock the claim, move it to
      APPROVED, credit the wallet. Any failure rolls all of it back, so a
      wallet error never leaves an approved-but-uncredited claim behind, and a
      failed status update never leaves free tokens.
   5. Rejection moves no money: nothing was ever credited, so there is nothing
      to reverse. The claim simply stops being pending.

   Legal gate
   ----------
   Filing a claim and reviewing one are gated on `MONEY_MODE` (see
   docs/SYSTEM_DESIGN.md §2, rule G1). When the gate is closed, the member-facing
   endpoints refuse before anything is written, and reviews are refused too, so
   the queue can never be worked while the feature is dark. Reading the queue is
   not gated: an admin must always be able to see what a claim says.
   ========================================================================== */

/** Rupees credited as tokens, per rupee paid. One place to change the rate. */
export const TOKENS_PER_RUPEE = 1;

/** Smallest claim. Anything above zero is accepted, so this is only a floor. */
export const MIN_PAYMENT_AMOUNT = 1;

/**
 * Largest claim in rupees. A manual UPI transfer above this is almost always a
 * mistake, and the cap keeps one member from parking the whole ledger limit in
 * a single pending row.
 */
export const MAX_PAYMENT_AMOUNT = 100_000;

/** A member may not stack an unbounded queue of unreviewed claims. */
export const MAX_PENDING_PER_MEMBER = 5;

/**
 * Length and character rules for a UTR live in `src/lib/bank-reference.ts`,
 * which the payout reference an admin records uses too. Reuse matters more than
 * it looks: a reference normalised one way on the way in and another way on the
 * way out stops matching the bank statement you are reading.
 */

/* Note bounds are shared with the payout queue (`src/lib/review-note.ts`) and
   re-exported below, so both queues answer "why?" with the same rules. */

const MAX_SCREENSHOT_URL_LENGTH = 2048;
const MAX_ID_LENGTH = 64;

/** A money write waits up to 5 s for a pooled connection and up to 10 s overall. */
const PAYMENT_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/* ==========================================================================
   ERRORS
   ========================================================================== */

export type PaymentErrorCode =
  | "VALIDATION_ERROR"
  | "PAYMENTS_DISABLED"
  | "NO_ACTIVE_QR"
  | "PAYMENT_NOT_FOUND"
  | "NOT_PENDING"
  | "DUPLICATE_UTR"
  | "TOO_MANY_PENDING";

const HTTP_STATUS_BY_CODE: Record<PaymentErrorCode, number> = {
  VALIDATION_ERROR: 400,
  PAYMENTS_DISABLED: 503,
  NO_ACTIVE_QR: 404,
  PAYMENT_NOT_FOUND: 404,
  NOT_PENDING: 409,
  DUPLICATE_UTR: 409,
  TOO_MANY_PENDING: 429,
};

/** Expected business or validation failure. Routes map it to an HTTP response. */
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly status: number;

  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
  }
}

/* ==========================================================================
   TYPES
   ========================================================================== */

export type PaymentQr = {
  matchId: string;
  title: string;
  teamA: string;
  teamB: string;
  status: "LIVE" | "UPCOMING";
  startTime: Date;
  qrCodeUrl: string;
};

export type NewPaymentRequest = {
  amount: number;
  utrNumber: string;
  screenshotUrl: string;
};

/** Shape returned to a member after filing a claim. No admin fields, no notes. */
export type PaymentReceipt = {
  id: string;
  amount: number;
  tokensToCredit: number;
  utrNumber: string;
  status: PaymentStatus;
  createdAt: Date;
};

/** Shape returned to the review queue: the claim plus who filed it and who reviewed it. */
export type PaymentQueueItem = {
  id: string;
  amount: number;
  tokensToCredit: number;
  utrNumber: string;
  screenshotUrl: string;
  status: PaymentStatus;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string; referralCode: string };
  reviewedBy: { id: string; name: string; email: string } | null;
};

export type PaymentPage = {
  items: PaymentQueueItem[];
  /** Pass as `cursor` for the next, older page. Null on the last page. */
  nextCursor: string | null;
  /** Whole-queue totals for the queue header, independent of the current page. */
  counts: { PENDING: number; APPROVED: number; REJECTED: number };
};

export type ReviewResult = {
  payment: PaymentQueueItem;
  /** Present on approval: the balances after the credit and the ledger row written. */
  wallet?: WalletBalances;
  transaction?: LedgerEntry;
};

type LockedPayment = {
  id: string;
  userId: string;
  tokensToCredit: number;
  utrNumber: string;
  status: string;
};

const QR_SELECT = {
  id: true,
  title: true,
  teamA: true,
  teamB: true,
  status: true,
  startTime: true,
  qrCodeUrl: true,
} as const;

const QUEUE_SELECT = {
  id: true,
  amount: true,
  tokensToCredit: true,
  utrNumber: true,
  screenshotUrl: true,
  status: true,
  reviewNote: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, referralCode: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.PaymentRequestSelect;

/* ==========================================================================
   MEMBER: WHICH QR TO PAY INTO
   ========================================================================== */

/**
 * The QR a member should pay into, taken from the newest match that is still
 * accepting money.
 *
 * Preference order, most specific first:
 *   1. the match with the latest `startTime` among those that are LIVE;
 *   2. otherwise the same among those that are UPCOMING.
 * A LIVE match wins because money is being deposited while it is on air. Within
 * one group, the latest `startTime` is the most recently published one.
 *
 * A row with a null or blank `qrCodeUrl` is skipped in SQL, so an admin can
 * retire a QR by clearing the field instead of deleting the match.
 *
 * Throws NO_ACTIVE_QR (404) when nothing qualifies, which is how the client
 * knows to hide the "Add money" panel rather than show a broken image.
 */
export async function getActivePaymentQr(): Promise<PaymentQr> {
  requireMoneyMode();

  for (const status of ["LIVE", "UPCOMING"] as const) {
    const match = await prisma.match.findFirst({
      where: { status, qrCodeUrl: { not: null, gt: "" } },
      orderBy: [{ startTime: "desc" }, { createdAt: "desc" }],
      select: QR_SELECT,
    });
    if (!match) continue;

    const url = (match.qrCodeUrl ?? "").trim();
    if (url.length === 0) continue;

    return {
      matchId: match.id,
      title: match.title,
      teamA: match.teamA,
      teamB: match.teamB,
      status: match.status as "LIVE" | "UPCOMING",
      startTime: match.startTime,
      qrCodeUrl: url,
    };
  }

  throw new PaymentError(
    "NO_ACTIVE_QR",
    "No payment QR is published right now. Please try again later.",
  );
}

/* ==========================================================================
   MEMBER: FILE A CLAIM
   ========================================================================== */

/**
 * Creates a PENDING claim for a payment the member says they made.
 *
 * The row is the only write. Nothing in the wallet changes here, so a bogus
 * claim cannot mint tokens even if it is created successfully.
 *
 * Throws DUPLICATE_UTR (409) when the reference is already on file, and
 * TOO_MANY_PENDING (429) when the member already has MAX_PENDING_PER_MEMBER
 * claims in the queue.
 */
export async function createPaymentRequest(
  userId: string,
  input: NewPaymentRequest,
): Promise<PaymentReceipt> {
  requireMoneyMode();

  const amount = assertAmount(input.amount);
  const utrNumber = normalizeUtr(input.utrNumber);
  const screenshotUrl = normalizeScreenshotUrl(input.screenshotUrl);
  // One rupee is one token, so the cap on `amount` already keeps the credit far
  // below the wallet's own `MAX_BALANCE`. The wallet re-checks its limit anyway,
  // because it also serves other callers.
  const tokensToCredit = amount * TOKENS_PER_RUPEE;

  // Friendly duplicate message. The unique index still decides under a race.
  await assertUtrUnused(utrNumber);

  // Advisory cap, checked outside a transaction: two claims racing can both
  // pass. That is acceptable, because the cap protects a review queue and not a
  // balance, and the review itself is strictly serialised.
  const pending = await prisma.paymentRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_MEMBER) {
    throw new PaymentError(
      "TOO_MANY_PENDING",
      `You already have ${MAX_PENDING_PER_MEMBER} claims waiting for review. Wait for one to be processed.`,
    );
  }

  try {
    return await prisma.paymentRequest.create({
      data: { userId, amount, tokensToCredit, utrNumber, screenshotUrl, status: "PENDING" },
      select: {
        id: true,
        amount: true,
        tokensToCredit: true,
        utrNumber: true,
        status: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (isUtrConflict(error)) {
      throw new PaymentError(
        "DUPLICATE_UTR",
        "This UTR has already been submitted with another claim",
      );
    }
    throw error;
  }
}

/* ==========================================================================
   ADMIN: READ THE QUEUE
   ========================================================================== */

export type PaymentListFilters = {
  status?: PaymentStatus;
  userId?: string;
  limit?: number;
  cursor?: string | null;
};

/**
 * Claims newest first, keyset-paged on `(createdAt, id)` with the same cursor
 * format as the wallet ledger. `counts` covers the whole filtered queue, not
 * just the page, so the admin UI can label its tabs.
 */
export async function listPaymentRequests(
  filters: PaymentListFilters = {},
): Promise<PaymentPage> {
  const limit = resolveLimit(filters.limit);
  if (limit === null) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
    );
  }

  const after = filters.cursor ? parseCursorOrThrow(filters.cursor) : null;
  const where: Prisma.PaymentRequestWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(after
      ? {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }
      : {}),
  };

  const [rows, totals] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: QUEUE_SELECT,
    }),
    prisma.paymentRequest.groupBy({
      by: ["status"],
      where: {
        // Tabs count the queue for this member, or the whole platform.
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    counts: toCounts(totals),
  };
}

function toCounts(rows: { status: PaymentStatus; _count: { _all: number } }[]): PaymentPage["counts"] {
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

/* ==========================================================================
   ADMIN: APPROVE
   ========================================================================== */

/**
 * Approves a claim and credits the deposit balance.
 *
 *   BEGIN
 *     SELECT … FROM payment_requests WHERE id = … FOR UPDATE   (lock the claim)
 *     status must be PENDING                                     (else 409)
 *     UPDATE … SET status = 'APPROVED' WHERE status = 'PENDING'  (exactly 1 row)
 *     wallet creditDeposit(…)                                    (balance + ledger)
 *   COMMIT
 *
 * The row lock serialises two admins opening the same claim: the second waits,
 * then sees APPROVED and gets 409 instead of crediting twice. The conditional
 * update is the belt-and-braces version of the same rule, and it also covers a
 * caller that forgot to lock.
 *
 * `creditDeposit` checks the claim again from its side (APPROVED, and owned by
 * this member) and refuses a second credit for the same payment id through the
 * unique `(user_id, type, reference_id)` ledger index, so even a hand-edited
 * row cannot buy two credits. If the credit throws, the status change rolls
 * back with it: the claim stays PENDING and can be approved again once the data
 * is right. That is deliberate — a half-applied review is worse than none.
 */
export async function approvePaymentRequest(
  paymentId: string,
  adminId: string,
  reviewNote?: string | null,
): Promise<ReviewResult> {
  requireMoneyMode();

  const id = parsePaymentId(paymentId);
  const reviewerId = parsePaymentId(adminId, "admin id");
  const note = normalizeReviewNote(reviewNote, { required: false });

  return prisma.$transaction(async (tx) => {
    // Lock and read in one statement, so the values below cannot change
    // between the check and the write.
    const payment = await lockPayment(tx, id);
    if (!payment) throw notFound();

    if (payment.status !== "PENDING") {
      throw alreadyReviewed(payment.status);
    }

    const updated = await tx.paymentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: reviewerId, reviewNote: note },
    });
    if (updated.count !== 1) {
      throw new PaymentError(
        "NOT_PENDING",
        "Another reviewer changed this claim first. Reload the queue.",
      );
    }

    // The reviewed token figure is what gets credited, not the claimed rupee
    // amount. They are equal for an ordinary claim, and a partial approval is
    // expressed by lowering `tokensToCredit`.
    //
    // Joins this transaction, so the balance change, the ledger row and the
    // status change commit together or not at all.
    const credit = await creditDeposit(
      payment.userId,
      payment.tokensToCredit,
      id,
      `Deposit approved (UTR ${payment.utrNumber})`,
      { tx },
    );

    const reviewed = await tx.paymentRequest.findUnique({
      where: { id },
      select: QUEUE_SELECT,
    });
    if (!reviewed) throw notFound();

    return {
      payment: reviewed,
      wallet: credit.balances,
      transaction: credit.entry,
    } satisfies ReviewResult;
  }, PAYMENT_TX_OPTIONS);
}

/* ==========================================================================
   ADMIN: REJECT
   ========================================================================== */

/**
 * Rejects a claim with a note the member can read later.
 *
 * No wallet write and no interactive transaction: nothing was credited, so
 * there is nothing to reverse, and the conditional update makes a double review
 * impossible in a single statement.
 */
export async function rejectPaymentRequest(
  paymentId: string,
  adminId: string,
  reviewNote: string,
): Promise<ReviewResult> {
  requireMoneyMode();

  const id = parsePaymentId(paymentId);
  const reviewerId = parsePaymentId(adminId, "admin id");
  const note = normalizeReviewNote(reviewNote, { required: true });

  const updated = await prisma.paymentRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: reviewerId, reviewNote: note },
  });

  if (updated.count === 1) {
    const payment = await prisma.paymentRequest.findUnique({
      where: { id },
      select: QUEUE_SELECT,
    });
    if (!payment) throw notFound();
    return { payment };
  }

  const existing = await prisma.paymentRequest.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw notFound();
  throw alreadyReviewed(existing.status);
}

/* ==========================================================================
   INTERNALS
   ========================================================================== */

function requireMoneyMode(): void {
  if (!moneyModeEnabled()) {
    throw new PaymentError("PAYMENTS_DISABLED", MONEY_MODE_OFF_MESSAGE);
  }
}

/**
 * Reads one claim under a row lock. `FOR UPDATE` makes a second reviewer wait
 * until this transaction ends, so both cannot pass the PENDING check.
 *
 * `status` arrives as the enum label (a string), because `$queryRaw` does not
 * map PostgreSQL enums onto the Prisma union.
 */
async function lockPayment(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedPayment | null> {
  const rows = await tx.$queryRaw<LockedPayment[]>`
    SELECT "id",
           "user_id"          AS "userId",
           "tokens_to_credit" AS "tokensToCredit",
           "utr_number"       AS "utrNumber",
           "status"::text     AS "status"
    FROM "payment_requests"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function assertUtrUnused(utrNumber: string): Promise<void> {
  const clash = await prisma.paymentRequest.findUnique({
    where: { utrNumber },
    select: { id: true },
  });
  if (clash) {
    throw new PaymentError(
      "DUPLICATE_UTR",
      "This UTR has already been submitted with another claim",
    );
  }
}

function notFound(): PaymentError {
  return new PaymentError("PAYMENT_NOT_FOUND", "Payment request not found");
}

/** `status` is the enum label, so a raw read and a typed read both fit here. */
function alreadyReviewed(status: string): PaymentError {
  return new PaymentError(
    "NOT_PENDING",
    `Only a PENDING claim can be reviewed. This one is ${status}.`,
  );
}

function parseCursorOrThrow(cursor: string): { createdAt: Date; id: string } {
  const position = decodeCursor(cursor);
  if (!position) throw new PaymentError("VALIDATION_ERROR", "cursor is not valid");
  return position;
}

/* ==========================================================================
   VALIDATION
   ========================================================================== */

export function assertAmount(amount: number): number {
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < MIN_PAYMENT_AMOUNT ||
    amount > MAX_PAYMENT_AMOUNT
  ) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      `amount must be a whole number of rupees from ${MIN_PAYMENT_AMOUNT} to ${MAX_PAYMENT_AMOUNT}`,
    );
  }
  return amount;
}

/** Trimmed, inner whitespace collapsed and upper-cased, so " utr-12 " and
 * "UTR-12" are the same reference. The length and character rules are shared
 * with the payout reference, and the message keeps the field name the member
 * used, so a 400 still points at the right input. */
export function normalizeUtr(value: string): string {
  if (typeof value !== "string") {
    throw new PaymentError("VALIDATION_ERROR", "utrNumber must be a string");
  }
  const normalized = canonicalizeReference(value);
  if (!isWellFormedReference(normalized)) {
    throw new PaymentError("VALIDATION_ERROR", referenceShapeMessage("utrNumber"));
  }
  return normalized;
}

/**
 * Proof links are stored, then opened by an admin. Both ends matter: a
 * `javascript:` or `data:` value would run in the reviewer's browser, and a
 * link to a loopback or cloud-metadata address turns the queue into a proxy.
 * The rules are shared with the match QR (src/lib/external-url.ts) — one list
 * of shapes that must never be stored, kept in one place so the two fields
 * cannot drift apart. This function only refuses the clearly wrong ones.
 */
export function normalizeScreenshotUrl(value: string): string {
  const result = inspectExternalUrl(value, MAX_SCREENSHOT_URL_LENGTH);
  if (!result.ok) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      externalUrlMessage(
        "screenshotUrl",
        result.problem,
        MAX_SCREENSHOT_URL_LENGTH,
        "screenshotUrl must point at your storage host, not an internal address",
      ),
    );
  }
  return result.href;
}


export function normalizeReviewNote(
  value: string | null | undefined,
  options: { required: boolean },
): string | null {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new PaymentError(
        "VALIDATION_ERROR",
        "reviewNote is required so the member is told why the claim was rejected",
      );
    }
    return null;
  }

  if (typeof value !== "string") {
    throw new PaymentError("VALIDATION_ERROR", "reviewNote must be a string");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options.required) {
      throw new PaymentError("VALIDATION_ERROR", "reviewNote must not be blank");
    }
    return null;
  }
  if (options.required && trimmed.length < MIN_REVIEW_NOTE_LENGTH) {
    // "x" as a reason is a support ticket waiting to happen. The floor lives
    // here as well as in the route schema, because the service is the rule and
    // the schema is only the first line of defence.
    throw new PaymentError(
      "VALIDATION_ERROR",
      `reviewNote must be at least ${MIN_REVIEW_NOTE_LENGTH} characters`,
    );
  }
  if (trimmed.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      `reviewNote must be at most ${MAX_REVIEW_NOTE_LENGTH} characters`,
    );
  }
  return trimmed;
}

function parsePaymentId(value: string, label = "payment id"): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      `${label} must be 1 to ${MAX_ID_LENGTH} characters`,
    );
  }
  return trimmed;
}

function isUtrConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = error.meta?.target;
  return target === undefined || JSON.stringify(target).includes("utr_number");
}

/** Re-exported so the payment routes and the admin UI share one page-size rule. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
/** Re-exported for the same reason: one set of note bounds across both queues. */
export { MIN_REVIEW_NOTE_LENGTH, MAX_REVIEW_NOTE_LENGTH };

/* ==========================================================================
   MEMBER: READ MY OWN CLAIMS
   ========================================================================== */

/**
 * What a member is shown about their own claim.
 *
 * Deliberately not the queue item: `user` and `reviewedBy` are the admin's
 * context, not the member's, and a member already knows their own name. The
 * reviewer's *note* is kept, because on a rejection it is the only explanation
 * the member gets.
 */
const MY_SELECT = {
  id: true,
  amount: true,
  tokensToCredit: true,
  utrNumber: true,
  screenshotUrl: true,
  status: true,
  reviewNote: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PaymentRequestSelect;

export type MyPaymentRequest = {
  id: string;
  amount: number;
  tokensToCredit: number;
  utrNumber: string;
  screenshotUrl: string;
  status: PaymentStatus;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MyPaymentPage = {
  items: MyPaymentRequest[];
  nextCursor: string | null;
  /** Per-status counts over the member's whole history, so the app can badge "2 pending". */
  counts: { PENDING: number; APPROVED: number; REJECTED: number };
};

/**
 * The member's own claims, newest first, keyed on the same cursor format as the
 * admin queue and the wallet ledger.
 *
 * No `requireMoneyMode()` here: with the flag off a member can still file
 * nothing, but they must still be able to read what already happened. Hiding
 * history behind a deployment switch is how a support conversation starts at
 * zero.
 */
export async function listMyPaymentRequests(
  userId: string,
  filters: { status?: PaymentStatus; limit?: number; cursor?: string | null } = {},
): Promise<MyPaymentPage> {
  const limit = resolveLimit(filters.limit);
  if (limit === null) {
    throw new PaymentError(
      "VALIDATION_ERROR",
      `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
    );
  }

  const after = filters.cursor ? parseCursorOrThrow(filters.cursor) : null;
  const where: Prisma.PaymentRequestWhereInput = {
    userId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(after
      ? {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }
      : {}),
  };

  const [rows, counts] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: MY_SELECT,
    }),
    prisma.paymentRequest.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    counts: toCounts(counts),
  };
}
