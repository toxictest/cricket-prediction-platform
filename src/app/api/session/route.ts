import { getServerSession } from "next-auth";
import { guardRoute, apiSuccess, notFoundResponse, unauthorizedResponse } from "@/lib/http";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/session
 *
 * Canonical "who am I" endpoint. Unlike NextAuth's own `/api/auth/session`,
 * this reads the authoritative row from PostgreSQL, so it also reports the
 * live referral count and download history. Useful for the Android client and
 * for client components that need to poll membership state.
 */
async function handleGET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      referralCode: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { referrals: true, downloadLogs: true } },
    },
  });

  if (!user) {
    return notFoundResponse("Account no longer exists");
  }

  const { _count, ...rest } = user;

  return apiSuccess({
    user: rest,
    referralCount: _count.referrals,
    downloadCount: _count.downloadLogs,
  });
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/session", handleGET);
