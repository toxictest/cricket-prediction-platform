import type { User } from "@prisma/client";

/* ==========================================================================
   SHARED DOMAIN TYPES
   ========================================================================== */

/** Public projection of a member — never leak internal columns to the client. */
export type PublicUser = Pick<
  User,
  "id" | "name" | "email" | "image" | "referralCode" | "createdAt"
> & {
  /** ISO strings so the object is serialisable across the RSC boundary. */
  createdAtIso: string;
  lastLoginAtIso: string | null;
};

export type ReferralSummary = {
  id: string;
  name: string;
  image: string | null;
  joinedAtIso: string;
};

export type DashboardData = {
  user: PublicUser;
  referralCount: number;
  referrals: ReferralSummary[];
  downloadCount: number;
  lastDownloadAtIso: string | null;
  tier: {
    current: string;
    perk: string;
    next: string | null;
    nextAt: number | null;
    progress: number;
  };
};

/* ==========================================================================
   API ENVELOPE
   ========================================================================== */

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

/**
 * The response vocabulary for every route in this app, and nothing else.
 *
 * Grouped by who raises it. Transport and auth codes live here in full, because
 * they are shared. A domain is free to widen the type with its own codes —
 * `PaymentApiError` in `src/lib/payment-http.ts` is `PaymentErrorCode |
 * WalletErrorCode | ApiError["code"]` — and the mapper there annotates its body
 * `satisfies PaymentApiError`, so a new domain code cannot appear on the wire
 * without appearing in that domain's union. Widening is deliberate: making every
 * domain code a member of this union instead would let `NOT_FOUND` from one
 * service satisfy a caller that means `MATCH_NOT_FOUND` from another.
 *
 * Codes a client may branch on are therefore: these, plus the four `*ErrorCode`
 * unions in `src/lib/{wallet,payment,withdrawal,match}.ts`. `admin-guard` uses
 * `AdminApiError`, which is this type with the staff-auth codes added.
 */
export type ApiError = {
  ok: false;
  /** Human sentence. Safe to show a member or an operator verbatim. */
  error: string;
  code:
    /* ---- transport: the request itself was unusable ---- */
    | "VALIDATION_ERROR"
    /** Body was present but not parseable JSON. */
    | "INVALID_JSON"
    /** Body was not `application/json`. Blocks forced form posts. */
    | "UNSUPPORTED_MEDIA_TYPE"
    /* ---- auth: who are you ---- */
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "FORBIDDEN"
    /* ---- capacity: come back later ---- */
    | "RATE_LIMITED"
    /* ---- server: nothing the client did was wrong ---- */
    | "INTERNAL_ERROR"
    /** The staged APK is missing or too small to be a real build. */
    | "BUILD_UNAVAILABLE"
    /** The endpoint exists, but `MONEY_MODE` keeps it closed. */
    | "PAYMENTS_DISABLED"
    /** No live or upcoming match has a payment QR configured. */
    | "NO_ACTIVE_QR";
  /** Field details for a form (Zod's `flatten()` shape), or a small machine hint. */
  details?: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/* ==========================================================================
   DOWNLOAD
   ========================================================================== */

export type DownloadInfo = {
  fileName: string;
  version: string;
  packageName: string;
  sizeLabel: string;
  minAndroid: string;
  architecture: string;
  checksum: string;
  releasedAt: string;
  downloadUrl: string;
  features: readonly string[];
};
