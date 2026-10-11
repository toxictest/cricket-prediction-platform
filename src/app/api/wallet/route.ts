import { guardRoute, apiJson } from "@/lib/http";
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
async function handleGET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const balances = await getWallet(guard.userId);
    return apiJson({ ok: true, data: balances }, 200);
  } catch (error) {
    return walletErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/wallet", handleGET);
