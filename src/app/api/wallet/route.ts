import { apiJson } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { getWallet } from "@/lib/wallet";
import { walletErrorResponse } from "@/lib/wallet-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet
 *
 * The signed-in member's balances:
 *  - depositBalance: from approved payments only.
 *  - winningBalance: from winnings only. This is the only balance that can be withdrawn.
 *  - total: depositBalance + winningBalance.
 *  - withdrawableBalance: how much of winningBalance can be withdrawn now.
 *    MIN_RETAINED_WINNING_TOKENS always stays in the wallet.
 */
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const balances = await getWallet(guard.userId);
    return apiJson({ ok: true, data: balances }, 200);
  } catch (error) {
    return walletErrorResponse(error);
  }
}
