import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
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
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated", code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
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
    return NextResponse.json(
      { ok: false, error: "Account no longer exists", code: "NOT_FOUND" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { _count, ...rest } = user;

  return NextResponse.json(
    {
      ok: true,
      data: {
        user: rest,
        referralCount: _count.referrals,
        downloadCount: _count.downloadLogs,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
