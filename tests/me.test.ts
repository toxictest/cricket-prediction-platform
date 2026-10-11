import { afterAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/lib/user";
import { getMemberOverview } from "@/lib/me";
import { MIN_RETAINED_WINNING_TOKENS, creditWinning } from "@/lib/wallet";

/**
 * `GET /api/me` — the member snapshot, and the guard rule for every route that
 * speaks for a member.
 *
 * The first block is pure and always runs: it is the check that "the routes are
 * protected" is a property of the tree rather than of one file someone remembers
 * to edit. The second needs PostgreSQL, because balances, referral counts and the
 * missing-wallet case are all about rows.
 */

const RUN = `me${Date.now()}`;
let sequence = 0;
const API_DIR = join(process.cwd(), "src/app/api");

const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping the /api/me service tests.\n");
    return false;
  });

const createdUserIds: string[] = [];

afterAll(async () => {
  if (!dbAvailable || createdUserIds.length === 0) return;
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.downloadLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

/* ==========================================================================
   ROUTE PROTECTION (no database needed)
   ========================================================================== */

describe("the member-facing API surface", () => {
  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return routeFiles(path);
      return entry === "route.ts" ? [path] : [];
    });
  }

  /**
   * Routes that are open to anyone on purpose. Each entry is a decision, not an
   * oversight: the score is public because a match page is public, and the
   * referral lookup has to work for someone who has not signed up yet.
   */
  const PUBLIC_ROUTES = [
    "auth/[...nextauth]",
    "health",
    "referral",
    "referral/capture",
    "matches",
    "matches/[id]",
    "matches/[id]/score",
    "matches/live",
  ];

  const routes = routeFiles(API_DIR).map((path) => ({
    path,
    key: path.slice(API_DIR.length + 1).replace(/\/route\.ts$/, ""),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the routes at all, so this test cannot pass by globbing nothing", () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes.some((route) => route.key === "me")).toBe(true);
  });

  it("guards every route that speaks for a member", () => {
    const unguarded = routes
      .filter((route) => !route.key.startsWith("admin/"))
      .filter((route) => !PUBLIC_ROUTES.includes(route.key))
      .filter(
        (route) => !route.source.includes("requireMember(") && !route.source.includes("getServerSession("),
      )
      .map((route) => route.key);

    // `requireMember()` is the shared guard; `/api/session` and `/api/download`
    // read the session themselves because they answer for a guest as well as for
    // a member. Anything else that appears here is a route trusting a parameter
    // for identity.
    expect(unguarded).toEqual([]);
  });

  it("keeps the admin routes on the admin guard, not the member one", () => {
    const admin = routes.filter((route) => route.key.startsWith("admin/") && route.key !== "admin/login" && route.key !== "admin/logout");
    expect(admin.length).toBeGreaterThan(0);
    const missing = admin.filter((route) => !route.source.includes("requireAdmin(")).map((route) => route.key);
    expect(missing).toEqual([]);
  });

  it("leaves the public reads public, and says so in the source", () => {
    for (const key of PUBLIC_ROUTES.filter((route) => route.startsWith("matches"))) {
      const route = routes.find((entry) => entry.key === key);
      expect(route, `route ${key} should exist`).toBeDefined();
      expect(route!.source).not.toContain("requireMember(");
      expect(route!.source).toContain("No sign-in.");
    }

    // `/api/me` is the opposite case, and it is easy to "helpfully" make it
    // public: it must not be.
    const me = routes.find((entry) => entry.key === "me");
    expect(me!.source).toContain("requireMember(");
  });
});

/* ==========================================================================
   DATABASE: THE SNAPSHOT
   ========================================================================== */

async function newMember(label: string): Promise<string> {
  const { user } = await provisionUser({
    googleId: `${RUN}_${label}`,
    name: `Member ${label}`,
    email: `${RUN}.${label}@example.test`,
  });
  createdUserIds.push(user.id);
  return user.id;
}

describe.skipIf(!dbAvailable)("GET /api/me", () => {
  it("returns the profile fields a member may see, and only those", async () => {
    const id = await newMember("profile");
    const overview = await getMemberOverview(id);
    expect(overview).not.toBeNull();

    expect(Object.keys(overview!.user).sort()).toEqual(
      ["createdAt", "email", "id", "image", "lastLoginAt", "name", "referralCode"].sort(),
    );

    // `googleId` is the provider's immutable id and `referredById` points at
    // another member. Both live on this row; neither belongs in a response.
    const json = JSON.stringify(overview);
    expect(json).not.toMatch(/googleId/);
    expect(json).not.toMatch(/referredById/);
    expect(json).not.toMatch(/password/i);
  });

  it("carries the wallet through, with the retained minimum already applied", async () => {
    const id = await newMember("wallet");
    await creditWinning(id, 1000, `${RUN}_w1`, "Match won");

    const { wallet } = (await getMemberOverview(id))!;
    expect(wallet).toMatchObject({
      depositBalance: 0,
      winningBalance: 1000,
      total: 1000,
      withdrawableBalance: 1000 - MIN_RETAINED_WINNING_TOKENS,
    });
  });

  it("counts the referrals and the downloads", async () => {
    const id = await newMember("referrer");
    const profile = await prisma.user.findUniqueOrThrow({ where: { id }, select: { referralCode: true } });

    const referred = await provisionUser({
      googleId: `${RUN}_referred`,
      name: "Referred One",
      email: `${RUN}.referred@example.test`,
      referralCode: profile.referralCode,
    });
    createdUserIds.push(referred.user.id);
    await prisma.downloadLog.create({ data: { userId: id, version: "1.2.3", platform: "android" } });

    const overview = await getMemberOverview(id);
    expect(overview?.stats).toEqual({ referralCount: 1, downloadCount: 1 });
  });

  it("reports a missing wallet as absent, never as zero", async () => {
    // A member inserted without the wallet row provisioning guarantees. The
    // honest answer is "there is no wallet", not "there is 0".
    sequence += 1;
    const orphan = await prisma.user.create({
      data: {
        googleId: `${RUN}_orphan`,
        name: "Orphan",
        email: `${RUN}.orphan@example.test`,
        referralCode: `${RUN}ORP`.toUpperCase().slice(0, 24),
      },
      select: { id: true },
    });
    createdUserIds.push(orphan.id);

    const overview = await getMemberOverview(orphan.id);
    expect(overview?.wallet).toBeNull();
    expect(overview?.warnings).toHaveLength(1);
    expect(overview!.warnings[0]).toContain("no wallet row");
    // The profile is still there: a broken invariant about a wallet must not
    // take the member's own identity down with it.
    expect(overview?.user.name).toBe("Orphan");
  });

  it("returns nothing for an account that is not there", async () => {
    // A deleted member can still hold a valid session for up to a day. The route
    // turns this `null` into a 404 rather than an empty profile.
    await expect(getMemberOverview(`nonexistent-${RUN}`)).resolves.toBeNull();
  });
});
