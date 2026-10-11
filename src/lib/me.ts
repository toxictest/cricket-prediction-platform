import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WalletError, getWallet, type WalletBalances } from "@/lib/wallet";

/* ==========================================================================
   THE MEMBER SNAPSHOT — GET /api/me

   One read for the home screen of the app: who am I, and what do I hold. It is
   deliberately a *snapshot*, not a profile editor: nothing here writes, nothing
   here is configurable, and the fields are exactly the ones a member is allowed
   to see about themselves.

   Two things it is careful about:

   - The id comes from `requireMember()` (the signed NextAuth JWT), never from a
     parameter, so this endpoint cannot be pointed at somebody else.
   - The columns that identify a member *to Google* or *to another member* are not
     selected at all: `googleId` and `referredById` never appear in a response, even
     though they live on the same row. A test asserts the key set.
   ========================================================================== */

const ME_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  referralCode: true,
  createdAt: true,
  lastLoginAt: true,
} as const satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof ME_SELECT }>;

export type MemberOverview = {
  user: MemberRow;
  /**
   * The same four numbers `GET /api/wallet` returns, or `null` when the member has
   * no wallet row at all. Provisioning guarantees one (§6.1 of the design doc), so
   * `null` means that invariant was broken — an account inserted by hand, or a
   * failed migration — and reporting `0` would turn a fault into a lie about
   * somebody's money. `warnings` says so in the same response.
   */
  wallet: WalletBalances | null;
  stats: {
    /** Members who signed up using this member's code. */
    referralCount: number;
    /** Successful APK downloads by this member. */
    downloadCount: number;
  };
  warnings: string[];
};

/**
 * The member's own snapshot, or `null` when the account is gone.
 *
 * The account can be gone while the session is still valid: the JWT lives 30 days
 * and the DB resync runs every 24 h, so a deleted member keeps a token for up to a
 * day (review M4 in the design doc). Answering that with an empty profile would be
 * worse than a 404 — the client would render a member who does not exist.
 */
export async function getMemberOverview(userId: string): Promise<MemberOverview | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ME_SELECT,
  });
  if (!user) return null;

  const [wallet, referralCount, downloadCount] = await Promise.all([
    readWalletOrAbsent(userId),
    prisma.user.count({ where: { referredById: userId } }),
    prisma.downloadLog.count({ where: { userId } }),
  ]);

  return {
    user,
    wallet: wallet.balances,
    stats: { referralCount, downloadCount },
    warnings: wallet.warnings,
  };
}

/**
 * Balances if there is a wallet, absence if there is not, and a thrown error for
 * anything else. That last clause is the point of this helper: `getWallet` also
 * fails when the database is down, and a snapshot that answered `wallet: null` in
 * that case would tell a member their balance disappeared.
 */
async function readWalletOrAbsent(
  userId: string,
): Promise<{ balances: WalletBalances | null; warnings: string[] }> {
  try {
    return { balances: await getWallet(userId), warnings: [] };
  } catch (error) {
    if (error instanceof WalletError && error.code === "WALLET_NOT_FOUND") {
      return {
        balances: null,
        warnings: [
          "this account has no wallet row, which sign-up is supposed to guarantee; balances are reported as absent rather than zero",
        ],
      };
    }
    throw error;
  }
}
