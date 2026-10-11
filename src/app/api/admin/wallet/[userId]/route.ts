import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminErrorResponse, adminJson, requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";
import { getTransactionHistory, getWallet } from "@/lib/wallet";
import { parseHistoryQuery, walletErrorResponse } from "@/lib/wallet-http";
import { guardRoute } from "@/lib/http";

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
async function handleGET(
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
    return adminErrorResponse("NOT_FOUND", 404, "Member not found");
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

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/admin/wallet/[userId]", handleGET);
