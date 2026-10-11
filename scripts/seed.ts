/**
 * Development seed. Run it after `npm run db:setup` on a fresh database:
 *
 *   npm run db:seed
 *   SEED_TEST_MATCH=1 npm run db:seed        # + one UPCOMING fixture
 *   SEED_TEST_MATCH=live npm run db:seed     # + a LIVE fixture with a scoreboard
 *
 * What it does:
 *
 *   1. Creates the first Super Admin from ADMIN_EMAIL / ADMIN_PASSWORD /
 *      ADMIN_NAME, through the same `createFirstSuperAdmin` that
 *      `npm run admin:create-super` uses — one password policy, one
 *      "if any admin exists, change nothing" rule, and no second
 *      implementation to fall out of step with the first.
 *      ADMIN_NAME may be left unset here (the email's local part becomes
 *      the display name), because a missing label must not abort a
 *      `prisma migrate reset`; `admin:create-super` still asks for it.
 *   2. Optionally creates one demo match, tagged with the fixed `externalId`
 *      "seed-demo-match", so running the seed twice cannot create two fixtures
 *      for the same fixture.
 *
 * What it never does: touch a wallet, file a claim, or approve anything. A seed
 * that mints balances is how a developer ends up "testing" a payout against
 * tokens nobody deposited, and how those rows reach a shared staging database.
 * Members arrive through Google sign-in; money rows are filed through the API so
 * the real rules run on them.
 *
 * Exits 0 with a warning when ADMIN_* is unset instead of failing, because `prisma
 * migrate dev` and `migrate reset` run this file automatically and a seed that
 * cannot invent a password should not break a migration.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) config({ path, override: false });
}

/** The demo fixture. `externalId` is the idempotency key — see above. */
const DEMO_EXTERNAL_ID = "seed-demo-match";
const DEMO_MATCH = {
  title: "India vs Australia, 3rd T20I (seed demo)",
  teamA: "India",
  teamB: "Australia",
};

async function main(): Promise<number> {
  const { prisma } = await import("../src/lib/prisma");

  try {
    /* ---------------- 1. the first Super Admin ---------------- */
    const email = (process.env.ADMIN_EMAIL ?? "").trim();
    const password = process.env.ADMIN_PASSWORD ?? "";
    // `createFirstSuperAdmin` requires a display name, and `admin:create-super`
    // makes the operator type all three variables. The seed is what runs inside
    // `prisma migrate reset`, where a missing *label* must not abort a migration
    // run — so an unset ADMIN_NAME falls back to the email's local part, and the
    // fallback is printed rather than applied silently.
    const name = (process.env.ADMIN_NAME ?? "").trim() || email.split("@")[0];
    const adminCount = await prisma.adminUser.count();

    let adminId: string | null = null;

    if (email && password) {
      const { bootstrapInputSchema, createFirstSuperAdmin } = await import("../src/lib/admin-bootstrap");
      const parsed = bootstrapInputSchema.safeParse({ email, password, name });

      if (!parsed.success) {
        // An operator asked for an admin and gave a value the policy refuses. That
        // is a real failure, not something to warn past.
        console.error("Cannot create the Super Admin:");
        const reported = new Set<string>();
        for (const issue of parsed.error.issues) {
          const field = issue.path.join(".");
          if (reported.has(field)) continue;
          reported.add(field);
          console.error(`  - ${issue.message}`);
        }
        return 1;
      }

      const result = await createFirstSuperAdmin(parsed.data);
      if (result.status === "created") {
        adminId = result.adminId;
        console.log(`✓ Super Admin created: ${result.email}`);
        if (!(process.env.ADMIN_NAME ?? "").trim()) {
          console.log(`  (ADMIN_NAME was unset, so the display name is "${parsed.data.name}")`);
        }
      } else {
        console.log("• Super Admin skipped — an admin account already exists.");
      }
    } else if (adminCount === 0) {
      console.warn(
        "⚠ No admin created: ADMIN_EMAIL and ADMIN_PASSWORD are unset and `admin_users` is empty.\n" +
          "  Set them in .env.local (never on the command line, so they stay out of shell\n" +
          "  history) and run `npm run admin:create-super`. The panel at /admin has no other way in.",
      );
    } else {
      console.log(`• Super Admin skipped — ${adminCount} admin account(s) already exist.`);
    }

    /* ---------------- 2. the optional demo fixture ---------------- */
    const mode = (process.env.SEED_TEST_MATCH ?? "").trim().toLowerCase();

    if (!mode || mode === "0" || mode === "false") {
      console.log("• No demo match (set SEED_TEST_MATCH=1 or SEED_TEST_MATCH=live).");
      return 0;
    }

    const actor = await resolveActor(prisma, adminId);
    if (!actor) {
      console.warn("⚠ Demo match skipped: a match is created *by* an admin, and there is no admin to act.");
      return 0;
    }

    const { createMatch, updateMatch, upsertLiveScore } = await import("../src/lib/match");
    const wantsLive = mode === "live";

    // Idempotency through the unique `externalId`, not by pre-checking the table:
    // a second run finds the row it made last time and says so.
    const existing = await prisma.match.findUnique({
      where: { externalId: DEMO_EXTERNAL_ID },
      select: { id: true, status: true },
    });

    let matchId: string;

    if (existing) {
      matchId = existing.id;
      console.log(`• Demo match already present (${existing.status}): id ${matchId}`);
    } else {
      const created = await createMatch(
        {
          ...DEMO_MATCH,
          // A live match has already started; an upcoming one has not.
          startTime: new Date(Date.now() + (wantsLive ? -45 : 24) * 60 * 60_000),
          externalId: DEMO_EXTERNAL_ID,
        },
        actor,
      );
      matchId = created.id;
      console.log(`✓ Demo match created: ${created.title}`);
    }

    if (wantsLive) {
      if (existing?.status !== "LIVE") {
        await updateMatch(matchId, { status: "LIVE" }, actor);
        console.log("✓ Demo match moved to LIVE — predictions for it lock at the first ball.");
      }

      // Check before writing: `upsertLiveScore` accepts an unchanged board and
      // bumps its version, and a seed that inflates the version on every run is a
      // seed that makes the next real score write look stale.
      const board = await prisma.liveScore.findUnique({
        where: { matchId },
        select: { version: true },
      });

      if (board) {
        console.log(`• Demo scoreboard already exists (version ${board.version}).`);
      } else {
        await upsertLiveScore(
          matchId,
          { teamAScore: "0/0", teamBScore: "0/0", currentOver: "0.0" },
          actor,
        );
        console.log("✓ Demo scoreboard row created at 0/0, over 0.0.");
      }
      console.log(`  Poll it: GET /api/matches/${matchId}/score`);
    }

    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

/** Any active super admin may create a fixture; a fresh seed has exactly one. */
async function resolveActor(
  prisma: PrismaClient,
  preferredId: string | null,
): Promise<{ id: string; isSuperAdmin: boolean } | null> {
  const where: Prisma.AdminUserWhereInput = {
    isActive: true,
    // Either the admin just created, or any super admin already in the table.
    // `OR` takes an array: a lone object there is a runtime error Prisma reports
    // and TypeScript does not, because the filter was assembled conditionally.
    ...(preferredId
      ? { OR: [{ id: preferredId }, { roles: { has: "SUPER_ADMIN" } }] }
      : { roles: { has: "SUPER_ADMIN" } }),
  };

  const admin = await prisma.adminUser.findFirst({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, roles: true },
  });

  if (!admin) return null;
  return { id: admin.id, isSuperAdmin: admin.roles.includes("SUPER_ADMIN") };
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
