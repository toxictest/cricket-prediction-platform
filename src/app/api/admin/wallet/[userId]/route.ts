import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";
import { getTransactionHistory, getWallet } from "@/lib/wallet";
import { parseHistoryQuery, walletErrorResponse } from "@/lib/wallet-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roles that may read a member's wallet and ledger (design doc §6.6). SUPER_ADMIN must be listed explicitly. */
const WALLET_READ_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN", "SUPPORT_ADMIN"];

/**
 * GET /api/admin/wallet/:userId?limit=20&cursor=...
 *
 * Read-only view of one member: profile, balances, and a page of ledger rows.
 * It does not change any data. Reads are not written to an audit log yet.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const guard = await requireAdmin(WALLET_READ_ROLES);
  if (!guard.ok) return guard.response;

  const { userId } = await context.params;

  const query = parseHistoryQuery(request.nextUrl.searchParams);
  if (!query.ok) return query.response;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    return adminJson(
      { ok: false, error: "Member not found", code: "NOT_FOUND" },
      404,
    );
  }

  try {
    const [wallet, transactions] = await Promise.all([
      getWallet(user.id),
      getTransactionHistory(user.id, query.data),
    ]);

    return adminJson({ ok: true, data: { user, wallet, transactions } }, 200);
  } catch (error) {
    return walletErrorResponse(error);
  }
}
