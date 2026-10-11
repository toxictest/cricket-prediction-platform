/* ==========================================================================
   KEYSET PAGING PRIMITIVES
   ==========================================================================

   Used by every list endpoint in the money area (wallet ledger, payment and
   payout queues) and by the match lists. Offset paging is deliberately not offered: a page number shifts rows
   when a new row arrives, so a reviewer can see the same claim twice or skip
   one. Keyset paging compares on `(<sort column>, id)`, which never moves.

   A cursor is `base64url("<ISO createdAt>|<id>")`. Clients treat it as opaque.

   This module is shared by `src/lib/wallet.ts` and `src/lib/payment.ts`, so
   both services hand out and accept the same format.
   ========================================================================== */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Highest id length accepted inside a cursor. cuid ids are 25 characters. */
const MAX_CURSOR_ID_LENGTH = 64;

/**
 * Where a page ended. `at` is whatever the list is ordered by — a ledger row's
 * `createdAt`, a fixture's `startTime` — and `id` breaks a tie, because two rows
 * can share a timestamp to the millisecond and a cursor must not straddle them.
 */
export type SortPosition = {
  at: Date;
  id: string;
};

/** @deprecated Kept for the wallet and queue services; `SortPosition` is the general name. */
export type CursorPosition = {
  createdAt: Date;
  id: string;
};

/** Page size for a list query. `null` means the caller supplied an invalid value. */
export function resolveLimit(
  limit: number | undefined,
): number | null {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) return null;
  return limit;
}

export function encodeSortCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

/** Alias of `encodeSortCursor` for lists ordered by `createdAt`. */
export function encodeCursor(createdAt: Date, id: string): string {
  return encodeSortCursor(createdAt, id);
}

/** `null` when the cursor is malformed or points at nothing usable. */
export function decodeSortCursor(cursor: string): SortPosition | null {
  const raw = safeDecode(cursor);
  if (raw === null) return null;

  const separator = raw.indexOf("|");
  if (separator <= 0) return null;

  const at = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(at.getTime()) || id.length === 0 || id.length > MAX_CURSOR_ID_LENGTH) {
    return null;
  }

  return { at, id };
}

/** Alias of `decodeSortCursor` shaped for the lists that page on `createdAt`. */
export function decodeCursor(cursor: string): CursorPosition | null {
  const position = decodeSortCursor(cursor);
  return position ? { createdAt: position.at, id: position.id } : null;
}

/**
 * `Buffer.from(…, "base64url")` never throws — it drops invalid characters —
 * so a caller cannot rely on an exception to reject a bad cursor. Re-encode
 * what we decoded and compare: any difference means the input was not a cursor
 * we produced.
 */
function safeDecode(cursor: string): string | null {
  if (cursor.length === 0 || cursor.length > 512) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const roundTrip = Buffer.from(raw, "utf8").toString("base64url");
  return roundTrip === cursor ? raw : null;
}
