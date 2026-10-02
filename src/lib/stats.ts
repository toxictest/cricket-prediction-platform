import { prisma } from "@/lib/prisma";

/* ==========================================================================
   COMMUNITY STATS
   --------------------------------------------------------------------------
   Every number the marketing surface shows is counted from PostgreSQL at
   request time. Nothing here is a constant, and nothing is estimated: when a
   value cannot be measured it is returned as `null` so the UI can render an
   explicit dash instead of a plausible-looking invention.
   ========================================================================== */

export type CommunityStats = {
  /** Total registered members. */
  members: number | null;
  /** Members who joined through someone else's referral code. */
  referrals: number | null;
  /** APK downloads recorded across all members. */
  downloads: number | null;
  /** Round-trip time of the count query, measured on this very request. */
  latencyMs: number | null;
  /** False when the database could not be reached at all. */
  online: boolean;
};

const OFFLINE: CommunityStats = {
  members: null,
  referrals: null,
  downloads: null,
  latencyMs: null,
  online: false,
};

/**
 * Cache window for the *counts*. The landing page is public and heavily hit,
 * and the counts move slowly, so re-counting three tables on every request
 * would be wasteful.
 *
 * `latencyMs` is deliberately NOT cached: it is a statement about right now,
 * and replaying a 30-second-old sample would be a small lie. When the cache is
 * warm we measure it with a trivial `SELECT 1` instead.
 */
const TTL_MS = 30_000;

type Counts = { members: number; referrals: number; downloads: number };

let cache: { at: number; counts: Counts } | null = null;

/**
 * Counts the community from the live database.
 *
 * Uses `Promise.all` over three cheap `count()` calls rather than three
 * sequential round-trips, and swallows connection failures into an explicit
 * offline result — a public landing page must still render when Postgres is
 * down, just without numbers.
 */
export async function getCommunityStats(): Promise<CommunityStats> {
  const now = Date.now();
  const fresh = cache !== null && now - cache.at < TTL_MS;

  const startedAt = performance.now();

  try {
    if (fresh) {
      // Counts are reused; latency is measured live so the number on screen
      // always describes this request.
      await prisma.$queryRaw`SELECT 1`;

      return {
        ...cache!.counts,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        online: true,
      };
    }

    const [members, referrals, downloads] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { referredById: { not: null } } }),
      prisma.downloadLog.count(),
    ]);

    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
    cache = { at: now, counts: { members, referrals, downloads } };

    return { members, referrals, downloads, latencyMs, online: true };
  } catch (error) {
    console.error("[stats] community counts unavailable:", error);
    // Do not cache the failure for the full TTL — retry on the next render.
    cache = null;
    return OFFLINE;
  }
}

/** Clears the memoised counts — used by tests and the revalidate endpoint. */
export function invalidateStatsCache(): void {
  cache = null;
}

/**
 * Formats a count for the stat strip. `null` becomes an em dash (not "0"),
 * because "0 members" and "we could not read the database" are different
 * claims and the UI must not conflate them.
 */
export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-IN");
}
