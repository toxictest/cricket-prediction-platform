/* ==========================================================================
   BANK REFERENCE NUMBERS
   ==========================================================================

   A reference that points at a bank or UPI transfer, used twice in the money
   area: the UTR a member quotes for an incoming payment, and the reference an
   admin records for an outgoing payout. Both are the same shape, so both are
   canonicalised the same way — before that, " utr-12 " and "UTR-12" were two
   different strings, and a unique index would not have caught the reuse.

   The format test is deliberately loose. UPI references are 12 digits, IMPS
   and NEFT are commonly 18 to 22, and some banks prefix letters, so anything
   stricter would reject real payments. What matters is that a reference is
   short, unambiguous, and compared consistently — a wrong or invented one is
   caught by a human reading the statement.
   ========================================================================== */

export const MIN_REFERENCE_LENGTH = 8;
export const MAX_REFERENCE_LENGTH = 32;

/** Trim, collapse inner whitespace, upper-case. Never returns an empty string with content removed. */
export function canonicalizeReference(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isWellFormedReference(value: string): boolean {
  return (
    value.length >= MIN_REFERENCE_LENGTH &&
    value.length <= MAX_REFERENCE_LENGTH &&
    /^[A-Z0-9-]+$/.test(value)
  );
}

export function referenceShapeMessage(field: string): string {
  return `${field} must be ${MIN_REFERENCE_LENGTH} to ${MAX_REFERENCE_LENGTH} characters, letters, digits and hyphens only`;
}
