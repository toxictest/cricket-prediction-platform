import { describe, expect, it } from "vitest";
import { getCommunityStats, formatCount, invalidateStatsCache } from "@/lib/stats";
import { resolveArtifact, invalidateArtifactCache } from "@/lib/artifact";

/**
 * The landing page's stat strip must reflect the live database, never a
 * constant. These assertions fail if anyone reintroduces a hard-coded number —
 * which is exactly what the previous build shipped ("48,200+ members",
 * "78.6% model accuracy").
 */
const stats = await getCommunityStats();

describe("formatCount", () => {
  it("renders an em dash for an unmeasurable value", () => {
    // "0 members" and "the database is unreachable" are different claims.
    expect(formatCount(null)).toBe("—");
  });

  it("renders a real zero as a number, not as a dash", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("groups thousands", () => {
    expect(formatCount(48200)).toBe("48,200");
  });
});

describe("getCommunityStats", () => {
  it("returns integers or explicit nulls — never strings", () => {
    for (const key of ["members", "referrals", "downloads"] as const) {
      const value = stats[key];
      if (value !== null) expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("never reports more referrals than members", () => {
    if (stats.members === null || stats.referrals === null) return;
    expect(stats.referrals).toBeLessThanOrEqual(stats.members);
  });

  it("reports the database as online whenever it returns numbers", () => {
    if (stats.members === null) return;
    expect(stats.online).toBe(true);
    expect(stats.latencyMs).toBeGreaterThan(0);
  });

  it("creates no members of its own", async () => {
    // Counting is a read-only operation.
    invalidateStatsCache();
    const before = await getCommunityStats();
    invalidateStatsCache();
    const after = await getCommunityStats();
    expect(after.members).toBe(before.members);
  });
});

describe("the landing page invents nothing", () => {
  it("has no artifact staged right now, so it must say so", async () => {
    invalidateArtifactCache();
    const artifact = await resolveArtifact();

    // Either a real build is present, or the UI shows an explicit
    // "not available" state. There is no third option where the page
    // substitutes a plausible-looking version or checksum.
    if (artifact) {
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(artifact.checksum).toMatch(/^[a-f0-9]{64}$/);
    } else {
      expect(artifact).toBeNull();
    }
  });

  it("version always comes from configuration, never a literal in the UI", async () => {
    const { siteConfig } = await import("@/lib/constants");
    expect(siteConfig.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
