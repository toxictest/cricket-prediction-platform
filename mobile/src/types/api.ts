/**
 * The wire contract of the Next.js backend, mirrored here by hand.
 *
 * Mirrored rather than imported because the two projects build separately — and
 * because a hand-written copy is the place to *notice* when a field the app reads
 * stops existing. Every shape below was taken from the response of the route named
 * in its comment, not guessed.
 */

/* ---- envelope (src/lib/http.ts on the server) ---- */

export type ApiSuccess<T> = { ok: true; data: T };

export type ApiError = {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
};

/* ---- shared ---- */

export type MatchStatus = "UPCOMING" | "LIVE" | "COMPLETED";
export type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED";
export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED";
/**
 * `enum TransactionType` in prisma/schema.prisma. These five are the whole set —
 * an app that invents a sixth label is an app that renders a blank badge the day
 * someone adds one, so the label maps below fall through to the raw value.
 */
export type TransactionType = "DEPOSIT" | "WITHDRAWAL" | "WINNING" | "REFUND" | "ADMIN_ADJUST";
export type BalanceType = "DEPOSIT" | "WINNING";

export type Page<T> = { items: T[]; nextCursor: string | null };

/* ---- GET /api/me (MemberOverview) ---- */

export type Member = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  referralCode: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

/** WalletBalances: note `total`, not `totalBalance`. */
export type WalletBalances = {
  depositBalance: number;
  winningBalance: number;
  total: number;
  withdrawableBalance: number;
};

export type MemberOverview = {
  user: Member;
  wallet: WalletBalances | null;
  stats: { referralCount: number; downloadCount: number };
  warnings: string[];
};

/** POST /api/auth/mobile */
export type MobileSignInResult = {
  token: string;
  tokenType: "Bearer";
  expiresAt: number;
  expiresInSeconds: number;
  user: Pick<Member, "id" | "name" | "email" | "image" | "referralCode">;
  created: boolean;
};

/* ---- matches ---- */

export type MatchScore = {
  teamAScore: string;
  teamBScore: string;
  currentOver: string;
  version: number;
  updatedAt: string;
};

export type MatchView = {
  id: string;
  title: string;
  teamA: string;
  teamB: string;
  startTime: string;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
  score: MatchScore | null;
};

export type MatchPage = Page<MatchView> & { order: "asc" | "desc" };

/** The score fields are JSON the admin typed; the app renders what it recognises. */
export type BatterLine = {
  name?: string;
  runs?: number | string;
  balls?: number | string;
  fours?: number | string;
  sixes?: number | string;
  strikeRate?: number | string;
  onStrike?: boolean;
};

export type BowlerLine = {
  name?: string;
  overs?: string;
  maidens?: number | string;
  runs?: number | string;
  wickets?: number | string;
  economy?: number | string;
};

/** GET /api/matches/[id]/score → { match, score } */
export type LiveScorePayload = {
  match: Pick<MatchView, "id" | "title" | "teamA" | "teamB" | "status" | "startTime">;
  score: (MatchScore & { batsmanStats: unknown; bowlerStats: unknown }) | null;
};

/* ---- wallet ---- */

/** GET /api/wallet/transactions item (LedgerEntry). `amount` is signed. */
export type LedgerEntry = {
  id: string;
  type: TransactionType;
  /** Positive for a credit, negative for a debit — the server stores the sign. */
  amount: number;
  balanceType: BalanceType;
  balanceAfter: number;
  description: string | null;
  referenceId: string | null;
  createdAt: string;
};

/* ---- payments ---- */

/** GET /api/payment/qr */
export type PaymentQr = {
  matchId: string;
  title: string;
  teamA: string;
  teamB: string;
  status: MatchStatus;
  startTime: string;
  qrCodeUrl: string;
};

/** POST /api/payment/request */
export type PaymentReceipt = {
  id: string;
  amount: number;
  tokensToCredit: number;
  utrNumber: string;
  status: PaymentStatus;
  createdAt: string;
};

/** GET /api/payment/my item */
export type MyPaymentRequest = {
  id: string;
  amount: number;
  tokensToCredit: number;
  utrNumber: string;
  screenshotUrl: string;
  status: PaymentStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MyPaymentPage = Page<MyPaymentRequest> & {
  counts: { PENDING: number; APPROVED: number; REJECTED: number };
};

/* ---- withdrawals ---- */

/** POST /api/withdrawal/request */
export type WithdrawalReceipt = {
  id: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  createdAt: string;
  wallet: WalletBalances;
  transaction: LedgerEntry;
};

/** GET /api/withdrawal/my item */
export type MyWithdrawalItem = {
  id: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  reviewNote: string | null;
  adminUtr: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ---- referral (GET /api/referral) ---- */

/**
 * `GET /api/referral?code=CRC-XXXXXX` is a *validator*, not a summary: it answers
 * whether a code belongs to somebody, and returns only their first name. There is
 * no endpoint that lists who a member referred, so the app builds a share link from
 * `referralCode` and the API base url, and reads the count from `GET /api/me`.
 */
export type ReferralCheck = {
  code: string;
  referrerFirstName: string;
};
