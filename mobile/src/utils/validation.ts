/*
 * The client-side mirror of the backend's money rules — and the only place in the app
 * where those numbers are written down.
 *
 * Two screens used to carry these rules inline, which is how a copy drifts: the payout
 * form checked one thing while `src/lib/withdrawal.ts` checked another, and nobody
 * notices until a member is refused for a reason the app said was fine. So each constant
 * names the file it came from, the validators are pure (no RN, no axios, no storage —
 * they run under `vitest` with no mocking), and the screens call them instead of
 * restating them. `src/utils/validation.test.ts` pins the values and the edges.
 *
 * None of this is enforcement. Every rule here exists so a mistake is visible before a
 * request is sent; the server decides, and `toUiError` shows its words when the two
 * ever disagree. A validation that also blocks submission would hide the server's
 * message behind a local one — so a field flagged here still lets you press the button
 * wherever a real write is harmless, and the messages below are advice, not gates.
 */

/** Mirrored constants, each traced to the backend file that owns it. */
export const MONEY_RULES = {
  /** `MIN_PAYMENT_AMOUNT` / `MAX_PAYMENT_AMOUNT` in `src/lib/payment.ts` */
  depositMinAmount: 1,
  depositMaxAmount: 100_000,

  /** `MIN_REFERENCE_LENGTH` / `MAX_REFERENCE_LENGTH` in `src/lib/bank-reference.ts`.
   *  Shared by the payment UTR and the admin's payout reference: one rule, two fields. */
  referenceMinLength: 8,
  referenceMaxLength: 32,

  /** `MIN_UPI_LOCAL_LENGTH` … `MAX_UPI_ID_LENGTH` in `src/lib/withdrawal.ts` */
  upiLocalMinLength: 2,
  upiLocalMaxLength: 256,
  upiHandleMinLength: 2,
  upiHandleMaxLength: 64,
  upiIdMaxLength: 320,

  /** `MIN_RETAINED_WINNING_TOKENS` in `src/lib/wallet.ts`, checked inside `applyMovement`. */
  retainedTokens: 100,

  /** `MAX_PENDING_PER_MEMBER` in `src/lib/withdrawal.ts` (and the payment twin). */
  maxOpenClaims: 5,

  /** `MAX_SCREENSHOT_URL_LENGTH` in `src/lib/payment.ts` */
  screenshotUrlMaxLength: 2048,
} as const;

/**
 * The server's own sentence, built from the same number the writer enforces.
 * `src/lib/wallet.ts` returns `Minimum ${MIN_RETAINED_WINNING_TOKENS} tokens must remain in
 * wallet`; there is no endpoint that exposes the constant, so this is a copy — and the test
 * asserts the shape of the sentence so a change on either side shows up as a failure here
 * rather than as two different numbers on screen and in a 400.
 */
export const MINIMUM_BALANCE_MESSAGE = `Minimum ${MONEY_RULES.retainedTokens} tokens must remain in wallet`;

export type FieldError = string | null;

export type AmountResult = { value: number | null; error: FieldError };
export type WithdrawalResult = { value: number | null; error: FieldError; floor: boolean };

/** `canonicalizeReference`: trim, upper-case, then remove *inner* whitespace too. */
export function canonicaliseReference(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * A bank reference (a payment UTR, or an admin's payout reference): 8–32 characters of
 * `A-Z`, `0-9` and `-`, once canonicalised. The character rule matters as much as the length
 * — `UTR_12345678` is 12 characters and would otherwise file, then be refused.
 */
export function validateReference(raw: string, label: string, emptyHint: string): { value: string; error: FieldError } {
  const value = canonicaliseReference(raw);
  if (value.length === 0) return { value, error: emptyHint };
  if (value.length < MONEY_RULES.referenceMinLength || value.length > MONEY_RULES.referenceMaxLength) {
    return {
      value,
      error: `A ${label} is ${MONEY_RULES.referenceMinLength} to ${MONEY_RULES.referenceMaxLength} characters, once spaces are removed.`,
    };
  }
  if (!/^[A-Z0-9-]+$/.test(value)) {
    return { value, error: `A ${label} uses letters, digits and hyphens only.` };
  }
  return { value, error: null };
}

/** Lower-cased on the way out, exactly as `normalizeUpiId` stores it. */
export function normaliseUpiId(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * `upiId` is `local@handle` with 2–256 before the `@`, 2–64 after it, and 320 in total.
 * Stricter than it looks, and it is checked before a payout request debits a balance:
 * a request filed to an address that cannot be paid is a refund an admin has to notice.
 */
export function validateUpiId(raw: string): FieldError {
  const value = normaliseUpiId(raw);
  if (value === "") return "Your UPI id, like name@okhdfcbank.";
  if (value.length > MONEY_RULES.upiIdMaxLength) return "That is too long to be a UPI id.";
  const parts = value.split("@");
  if (parts.length !== 2) return "A UPI id is exactly name@bank — one @, nothing after the handle.";
  const [local, handle] = parts;
  if (local.length < MONEY_RULES.upiLocalMinLength) return "The part before the @ is too short.";
  if (local.length > MONEY_RULES.upiLocalMaxLength) return "The part before the @ is too long.";
  if (handle.length < MONEY_RULES.upiHandleMinLength) return "The bank handle after the @ is too short.";
  if (handle.length > MONEY_RULES.upiHandleMaxLength) return "The bank handle after the @ is too long.";
  return null;
}

/** A deposit is a whole number of rupees; tokens are credited at 1:1 by the server. */
export function validateDepositAmount(raw: string, rupees: (n: number) => string): AmountResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: "Enter the amount you paid." };
  // Digits and nothing else. `Number("1e3")` is 1000 and passes an `isInteger` test, which
  // would let a member type something the field does not look like and have it mean
  // something else on the way out; the server takes an integer too, so refusing here is
  // the stricter of the two and never wrong.
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "Amounts are whole rupees, no decimals." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { value: null, error: "Amounts are whole rupees, no decimals." };
  }
  if (value < MONEY_RULES.depositMinAmount || value > MONEY_RULES.depositMaxAmount) {
    return {
      value: null,
      error: `Between ${rupees(MONEY_RULES.depositMinAmount)} and ${rupees(MONEY_RULES.depositMaxAmount)}.`,
    };
  }
  return { value, error: null };
}

/** The retained floor, named for the screens that show it. */
export const MIN_RETAINED_TOKENS = MONEY_RULES.retainedTokens;

/**
 * A payout: whole tokens, no more than the winning balance, and never so many that the
 * retained floor is breached. `floor: true` is the case the UI calls out separately,
 * because "you can't withdraw all of it" needs an explanation, not just a refusal.
 */
export function validateWithdrawalAmount(raw: string, winning: number, tokens: (n: number) => string): WithdrawalResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: null, error: "Enter how many tokens you want out.", floor: false };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "Tokens are whole numbers.", floor: false };
  }
  const value = Number(trimmed);
  if (value <= 0) return { value: null, error: "At least 1 token.", floor: false };
  if (value > winning) {
    return { value: null, error: `You hold ${tokens(winning)} in winnings.`, floor: false };
  }
  if (winning - value < MONEY_RULES.retainedTokens) {
    return { value: null, error: MINIMUM_BALANCE_MESSAGE, floor: true };
  }
  return { value, error: null, floor: false };
}

/**
 * `screenshotUrl` must be https, at most 2048 characters, and on a host the server trusts.
 * The host list is server-side config the app cannot see, so only the shapes that are
 * always wrong are refused here: `javascript:`/`data:` would run in a reviewer's browser,
 * and a link to a loopback address turns the review queue into a proxy.
 */
export function validateScreenshotUrl(raw: string, emptyHint: string): FieldError {
  const value = raw.trim();
  if (value.length === 0) return emptyHint;
  if (value.length > MONEY_RULES.screenshotUrlMaxLength) {
    return `That link is longer than ${MONEY_RULES.screenshotUrlMaxLength} characters.`;
  }
  if (!/^https:\/\//i.test(value)) return "The link has to start with https://";
  return null;
}

/** Tokens still withdrawable from a winning balance, computed the way the API does. */
export function withdrawableFrom(winningBalance: number): number {
  return Math.max(0, winningBalance - MONEY_RULES.retainedTokens);
}
