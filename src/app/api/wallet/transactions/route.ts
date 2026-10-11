import type { NextRequest } from "next/server";
import { apiJson } from "@/lib/http";
import { requireMember } from "@/lib/member-auth";
import { getTransactionHistory } from "@/lib/wallet";
import { parseHistoryQuery, walletErrorResponse } from "@/lib/wallet-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/transactions?limit=20&cursor=...
 *
 * The signed-in member's ledger, newest first. `amount` is signed: positive for
 * a credit, negative for a debit. `balanceAfter` is the affected balance right
 * after the entry. Pass `nextCursor` back as `cursor` to get older entries.
 *
 * A deposit appears here once an admin has approved the payment, so this is also
 * where a member confirms that a claim they filed actually landed as tokens.
 */
export async function GET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const query = parseHistoryQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  try {
    const page = await getTransactionHistory(guard.userId, query.data);
    return apiJson({ ok: true, data: page }, 200);
  } catch (error) {
    return walletErrorResponse(error);
  }
}
