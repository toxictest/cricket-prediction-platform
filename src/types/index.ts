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

export type ApiError = {
  ok: false;
  error: string;
  /** Machine-readable code so the client can branch without string matching. */
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "VALIDATION_ERROR"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR"
    /** Body was not `application/json`. Blocks forced form posts. */
    | "UNSUPPORTED_MEDIA_TYPE"
    /** Body was present but not parseable JSON. */
    | "INVALID_JSON"
    /** The endpoint exists, but `MONEY_MODE` keeps it closed. */
    | "PAYMENTS_DISABLED"
    /** No live or upcoming match has a payment QR configured. */
    | "NO_ACTIVE_QR";
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
