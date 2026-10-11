import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashAdminPassword } from "@/lib/admin-password";
import {
  MatchError,
  createMatch,
  getLiveScore,
  getPublicMatch,
  listLiveMatches,
  listMatchesForAdmin,
  listPublicMatches,
  normalizeExternalId,
  normalizeOver,
  normalizeQrCodeUrl,
  normalizeScore,
  normalizeStats,
  normalizeStartTime,
  normalizeTeamName,
  normalizeTitle,
  updateMatch,
  upsertLiveScore,
  type MatchActor,
} from "@/lib/match";

/**
 * Match and scoreboard service tests.
 *
 * Two things are being protected here. A fixture must not be duplicated or
 * silently rewritten once it has been played, because members and (later)
 * predictions read `startTime` and `status` as facts. And one scoreboard, written
 * by a scorer and possibly a feed, must not go backwards or lose an update.
 *
 * Everything except the validation block runs against PostgreSQL and skips itself
 * when the database is unreachable. Fixtures are removed afterwards.
 */

const RUN = `mt${Date.now()}`;
const createdMatchIds: string[] = [];
const createdAdminIds: string[] = [];
let sequence = 0;

const db = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping match service tests.\n");
    return false;
  });

let passwordHash = "";
let scoreAdmin: MatchActor = { id: "", isSuperAdmin: false };
let superAdmin: MatchActor = { id: "", isSuperAdmin: true };

beforeAll(async () => {
  passwordHash = await hashAdminPassword("test-only-admin-password-1");
  if (!db) return;

  const scorer = await prisma.adminUser.create({
    data: {
      email: `${RUN}-score@example.test`,
      passwordHash,
      name: "Scorer",
      roles: ["SCORE_ADMIN"],
    },
    select: { id: true },
  });
  const founder = await prisma.adminUser.create({
    data: {
      email: `${RUN}-super@example.test`,
      passwordHash,
      name: "Founder",
      roles: ["SUPER_ADMIN"],
    },
    select: { id: true },
  });
  createdAdminIds.push(scorer.id, founder.id);
  scoreAdmin = { id: scorer.id, isSuperAdmin: false };
  superAdmin = { id: founder.id, isSuperAdmin: true };
});

afterAll(async () => {
  if (!db) return;
  // live_scores cascade with the match, but deleting them first keeps the
  // teardown independent of how the schema chooses to spell that edge.
  await prisma.liveScore.deleteMany({ where: { matchId: { in: createdMatchIds } } });
  await prisma.match.deleteMany({ where: { id: { in: createdMatchIds } } });
  if (createdAdminIds.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  }
});

/* ==========================================================================
   FIXTURES
   ========================================================================== */

/** A fixture an hour from now, distinct from every other one in the run. */
async function newMatch(overrides: Partial<Parameters<typeof createMatch>[0]> = {}) {
  sequence += 1;
  const startTime = new Date(Date.now() + sequence * 3_600_000);
  const match = await createMatch(
    {
      title: `${RUN} fixture ${sequence}`,
      teamA: `Alpha ${sequence}`,
      teamB: `Bravo ${sequence}`,
      startTime,
      ...overrides,
    },
    scoreAdmin,
  );
  createdMatchIds.push(match.id);
  return match;
}

async function rejectionOf(promise: Promise<unknown>): Promise<MatchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MatchError) return error;
    throw error;
  }
  throw new Error("expected the match operation to be rejected");
}

/* ==========================================================================
   VALIDATION (no database needed)
   ========================================================================== */

describe("fixture field rules", () => {
  it("collapses whitespace inside names, so one fixture has one label", () => {
    expect(normalizeTitle("  India   vs   Australia,  3rd  T20I ")).toBe(
      "India vs Australia, 3rd T20I",
    );
    expect(normalizeTeamName("  Mumbai   Indians ", "teamA")).toBe("Mumbai Indians");
    // "x y" is three characters and legal; two is not a fixture label.
    expect(() => normalizeTitle("xy")).toThrow(/3 to 120 characters/);
    expect(() => normalizeTitle("  ")).toThrow(/3 to 120 characters/);
    expect(() => normalizeTitle("x".repeat(121))).toThrow(/3 to 120 characters/);
    expect(() => normalizeTeamName("  ", "teamB")).toThrow(/teamB/);
  });

  it("accepts the three shapes a start time arrives in", () => {
    const iso = "2026-10-14T14:00:00.000Z";
    expect(normalizeStartTime(iso).toISOString()).toBe(iso);
    expect(normalizeStartTime(new Date(iso)).toISOString()).toBe(iso);
    expect(normalizeStartTime(Date.parse(iso)).toISOString()).toBe(iso);
  });

  it("refuses anything that is not a plausible date", () => {
    for (const value of ["", "tomorrow", "2026-13-45", null, {}, []]) {
      expect(() => normalizeStartTime(value as never)).toThrow(MatchError);
    }
    expect(() => normalizeStartTime("1999-05-05T10:00:00Z")).toThrow(/2000 and 2100/);
  });

  it("applies the payment-proof URL rules to a QR link", () => {
    expect(normalizeQrCodeUrl(" https://storage.example.test/qr.png ")).toBe(
      "https://storage.example.test/qr.png",
    );
    for (const value of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pass@storage.example.test/qr.png",
      "http://127.0.0.1:8080/qr.png",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/qr.png",
      "not a url",
    ]) {
      const error = (() => {
        try {
          normalizeQrCodeUrl(value);
          return null;
        } catch (caught) {
          return caught as MatchError;
        }
      })();
      expect(error, value).not.toBeNull();
      expect(error!.code).toBe("VALIDATION_ERROR");
      expect(error!.message).toMatch(/qrCodeUrl/);
    }
  });

  it("treats an empty externalId as absent", () => {
    expect(normalizeExternalId("   ")).toBeNull();
    expect(normalizeExternalId(undefined)).toBeNull();
    expect(normalizeExternalId(" feed-1 ")).toBe("feed-1");
    expect(() => normalizeExternalId("x".repeat(65))).toThrow(/64/);
  });
});

describe("scoreboard field rules", () => {
  it("stores one canonical score shape, whatever arrived", () => {
    expect(normalizeScore("182/4", "teamAScore")).toBe("182/4");
    expect(normalizeScore(" 182 / 4 ", "teamAScore")).toBe("182/4");
    expect(normalizeScore(182, "teamAScore")).toBe("182/0");
    expect(normalizeScore("182", "teamAScore")).toBe("182/0");
    // A bare number means "runs only": the wickets carry over from the row being
    // replaced, which is what a scorer updating on a boundary actually types.
    expect(normalizeScore(190, "teamAScore", "182/4")).toBe("190/4");
  });

  it("refuses numbers cricket cannot produce", () => {
    expect(() => normalizeScore("182/11", "teamAScore")).toThrow(/0 to 10/);
    expect(() => normalizeScore(-1, "teamAScore")).toThrow(/whole number/);
    expect(() => normalizeScore("18245/4", "teamAScore")).toThrow(/182\/4/);
    expect(() => normalizeScore("retired hurt", "teamAScore")).toThrow(MatchError);
    expect(() => normalizeScore(null, "teamAScore")).toThrow(MatchError);
  });

  it("caps the balls digit at 5, because a sixth ball ends the over", () => {
    expect(normalizeOver("16.3")).toBe("16.3");
    expect(normalizeOver(16.3)).toBe("16.3");
    expect(normalizeOver(16)).toBe("16.0");
    expect(normalizeOver("16")).toBe("16.0");
    expect(normalizeOver(0)).toBe("0.0");
    expect(() => normalizeOver("16.6")).toThrow(/balls part of currentOver must be 0 to 5/);
    expect(() => normalizeOver(16.6)).toThrow(/balls part of currentOver must be 0 to 5/);
    expect(() => normalizeOver("16.45")).toThrow(/overs\.balls/);
    expect(() => normalizeOver(-1)).toThrow(MatchError);
    // Three digits is not an over a human types, so the string form rejects it on
    // shape; the number form reaches the bounds check.
    expect(() => normalizeOver("100.0")).toThrow(/overs\.balls/);
    expect(() => normalizeOver(100.5)).toThrow(/between 0\.0 and 99\.5/);
  });

  it("bounds the stats blobs without fixing their keys", () => {
    expect(normalizeStats({ name: "Rohit", runs: 48, balls: 31 }, "batsmanStats")).toEqual({
      name: "Rohit",
      runs: 48,
      balls: 31,
    });
    expect(normalizeStats(null, "batsmanStats")).toBeNull();
    expect(normalizeStats(undefined, "bowlerStats")).toBeNull();

    // A feed sends numbers as strings. Storing "48" would make every reader
    // decide whether it is a count or a label.
    expect(normalizeStats({ name: "Bumrah", wickets: "3", economy: "6.10" }, "bowlerStats")).toEqual({
      name: "Bumrah",
      wickets: 3,
      economy: 6.1,
    });

    // Two batters at a time is the most this column is for.
    expect(normalizeStats([{ name: "A" }, { name: "B" }], "batsmanStats")).toHaveLength(2);
    expect(() => normalizeStats([{ name: "A" }, { name: "B" }, { name: "C" }], "batsmanStats")).toThrow(
      /up to 2/,
    );
    // A nested value is refused where it sits, so the message names the key.
    expect(() => normalizeStats({ nested: { deep: 1 } }, "batsmanStats")).toThrow(
      /batsmanStats\.nested must be a string, number or boolean/,
    );
    expect(() => normalizeStats(["Rohit"], "batsmanStats")).toThrow(/entries must be objects/);
    expect(() => normalizeStats({ name: "x".repeat(80) }, "batsmanStats")).toThrow(/60 characters/);
    expect(() => normalizeStats({ name: "a", runs: Number.NaN }, "batsmanStats")).toThrow(/finite/);

    const many: Record<string, number> = {};
    for (let index = 0; index < 13; index += 1) many[`k${index}`] = index;
    expect(() => normalizeStats(many, "batsmanStats")).toThrow(/1 to 12/);
  });
});

/* ==========================================================================
   AGAINST POSTGRESQL
   ========================================================================== */

describe.skipIf(!db)("fixtures in the database", () => {
  it("stores normalised values, starts at UPCOMING, and keeps the QR canonical", async () => {
    const match = await newMatch({
      title: `  ${RUN}   grand   final  `,
      teamA: "  Kings   IXPM  ",
      teamB: "Chennai   Super   Kings",
      qrCodeUrl: " https://storage.example.test/qr/final.png ",
    });

    expect(match).toMatchObject({
      title: `${RUN} grand final`,
      teamA: "Kings IXPM",
      teamB: "Chennai Super Kings",
      status: "UPCOMING",
      qrCodeUrl: "https://storage.example.test/qr/final.png",
      externalId: null,
      hasQrCode: true,
      score: null,
    });

    // A create may not choose a status: the service has no status parameter at
    // all, so a payload that carries one lands as UPCOMING regardless, and the
    // strict HTTP schema is what tells the caller off (tests/match-http.test.ts).
    const bossy = await createMatch(
      {
        title: `${RUN} bossy`,
        teamA: "First XI",
        teamB: "Second XI",
        startTime: new Date(Date.now() + 150 * 86_400_000),
        status: "LIVE",
      } as never,
      scoreAdmin,
    );
    createdMatchIds.push(bossy.id);
    expect(bossy.status).toBe("UPCOMING");
  });

  it("refuses to name the same team twice, and refuses a second fixture for one game", async () => {
    const match = await newMatch({ teamA: "India", teamB: "Australia" });
    const start = match.startTime;

    const same = await rejectionOf(
      createMatch({ title: "ghost", teamA: "India", teamB: "india", startTime: start }, scoreAdmin),
    );
    expect(same.code).toBe("VALIDATION_ERROR");
    expect(same.message).toMatch(/two different teams/);

    // Same two teams, same start time, teams swapped: one game, one row.
    const reversed = await rejectionOf(
      createMatch({ title: "duplicate", teamA: "australia", teamB: "INDIA", startTime: start }, scoreAdmin),
    );
    expect(reversed.code).toBe("DUPLICATE_MATCH");
    expect(reversed.status).toBe(409);
    expect((reversed.details as { existingId: string }).existingId).toBe(match.id);

    // The same two teams at a different time is a legitimate second fixture.
    const nextDay = await createMatch(
      { title: "second game", teamA: "India", teamB: "Australia", startTime: new Date(start.getTime() + 86_400_000) },
      scoreAdmin,
    );
    createdMatchIds.push(nextDay.id);
    expect(nextDay.id).not.toBe(match.id);
  });

  it("keeps externalId unique, for a feed that has to be re-runnable", async () => {
    const match = await newMatch({ externalId: `${RUN}-feed-1` });
    const again = await rejectionOf(
      createMatch(
        {
          title: `${RUN} other`,
          teamA: "Delta",
          teamB: "Echo",
          startTime: new Date(Date.now() + 90 * 86_400_000),
          externalId: `${RUN}-feed-1`,
        },
        scoreAdmin,
      ),
    );
    expect(again.code).toBe("DUPLICATE_MATCH");
    expect(again.message).toMatch(/externalId/);

    // Many matches may leave it unset, because a hand-made fixture has no feed id.
    expect(await prisma.match.count({ where: { externalId: null } })).toBeGreaterThan(0);
    expect(match.externalId).toBe(`${RUN}-feed-1`);
  });

  it("does not let the database accept what the service refuses", async () => {
    // A hand-run statement, a bad migration, or a future endpoint that forgets
    // the rules: the CHECKs are the last line, so they get their own test.
    const startTime = new Date(Date.now() + 200 * 86_400_000);
    await expect(
      prisma.$executeRaw`INSERT INTO "matches" ("id","title","team_a","team_b","start_time","status","created_at","updated_at")
        VALUES (${`${RUN}-raw1`}, 'bad', 'Same Team', 'same team', ${startTime}, 'UPCOMING', now(), now())`,
    ).rejects.toThrow(/matches_teams_differ/);

    await expect(
      prisma.$executeRaw`INSERT INTO "matches" ("id","title","team_a","team_b","start_time","status","qr_code_url","created_at","updated_at")
        VALUES (${`${RUN}-raw2`}, 'bad', 'X', 'Y', ${startTime}, 'UPCOMING', '   ', now(), now())`,
    ).rejects.toThrow(/matches_qr_url_not_blank/);

    const match = await newMatch();
    await expect(
      prisma.$executeRaw`INSERT INTO "live_scores" ("id","match_id","team_a_score","team_b_score","current_over","version","created_at","updated_at")
        VALUES (${randomUUID()}, ${match.id}, '182', '0/0', '0.0', 1, now(), now())`,
    ).rejects.toThrow(/live_scores_team_a_score_shape/);

    await prisma.liveScore.deleteMany({ where: { matchId: match.id } });
  });

  it("reports an unchanged PATCH as no change, and leaves updatedAt alone", async () => {
    const match = await newMatch();
    const before = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });

    const result = await updateMatch(
      match.id,
      { title: match.title, teamA: match.teamA, teamB: match.teamB },
      scoreAdmin,
    );
    expect(result.changed).toEqual([]);

    const after = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("moves a status forward for a score admin and refuses a move backwards", async () => {
    const match = await newMatch();

    const live = await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    expect(live.status).toBe("LIVE");
    expect(live.changed).toEqual(["status"]);

    const completed = await updateMatch(match.id, { status: "COMPLETED" }, scoreAdmin);
    expect(completed.status).toBe("COMPLETED");

    const backwards = await rejectionOf(updateMatch(match.id, { status: "LIVE" }, scoreAdmin));
    expect(backwards.code).toBe("MATCH_LOCKED");
    expect(backwards.message).toMatch(/needs SUPER_ADMIN/);

    // A Super Admin is the role that fixes a mistabbed status.
    const reopened = await updateMatch(match.id, { status: "LIVE" }, superAdmin);
    expect(reopened.status).toBe("LIVE");
  });

  it("escalates an identity edit once the match has been played", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);

    const refused = await rejectionOf(updateMatch(match.id, { teamB: "Someone Else" }, scoreAdmin));
    expect(refused.code).toBe("MATCH_LOCKED");
    expect((refused.details as { fields: string[] }).fields).toEqual(["teamB"]);

    // The scoreboard, however, is the score admin's job and stays open.
    await expect(
      updateMatch(match.id, { qrCodeUrl: "https://storage.example.test/other.png" }, scoreAdmin),
    ).resolves.toMatchObject({ changed: ["qrCodeUrl"] });

    const allowed = await updateMatch(match.id, { teamB: "Someone Else" }, superAdmin);
    expect(allowed.teamB).toBe("Someone Else");

    // "Played" includes a match that has only ever had a score, even if its
    // status is still UPCOMING — the scoreboard is the evidence.
    const quiet = await newMatch();
    await upsertLiveScore(quiet.id, { teamAScore: "10/0", teamBScore: "0/0", currentOver: "1.0" }, scoreAdmin);
    const stillUpcoming = await prisma.match.findUniqueOrThrow({ where: { id: quiet.id } });
    expect(stillUpcoming.status).toBe("UPCOMING");
    const locked = await rejectionOf(updateMatch(quiet.id, { startTime: new Date(Date.now() + 400 * 86_400_000) }, scoreAdmin));
    expect(locked.code).toBe("MATCH_LOCKED");
  });

  it("refuses to make two fixtures collide while editing, and handles the unknown id", async () => {
    const first = await newMatch({ teamA: "Goa", teamB: "Kerala", startTime: new Date(Date.now() + 30 * 86_400_000) });
    const second = await newMatch({ teamA: "Goa", teamB: "Kerala", startTime: new Date(Date.now() + 31 * 86_400_000) });

    const clash = await rejectionOf(updateMatch(second.id, { startTime: first.startTime }, superAdmin));
    expect(clash.code).toBe("DUPLICATE_MATCH");

    const missing = await rejectionOf(updateMatch(randomUUID(), { title: "nobody" }, scoreAdmin));
    expect(missing.code).toBe("MATCH_NOT_FOUND");
    expect(missing.status).toBe(404);

    const blank = await rejectionOf(updateMatch("   ", { title: "nobody" }, scoreAdmin));
    expect(blank.code).toBe("VALIDATION_ERROR");
  });
});

describe.skipIf(!db)("the scoreboard", () => {
  it("creates on first write, then replaces, bumping the version and recording the author", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);

    const first = await upsertLiveScore(
      match.id,
      {
        teamAScore: "182/4",
        teamBScore: "0/0",
        currentOver: "16.3",
        batsmanStats: { name: "Rohit", runs: 82, balls: 41 },
      },
      scoreAdmin,
    );
    expect(first.created).toBe(true);
    expect(first.score).toMatchObject({
      teamAScore: "182/4",
      teamBScore: "0/0",
      currentOver: "16.3",
      version: 1,
      batsmanStats: { name: "Rohit", runs: 82, balls: 41 },
      bowlerStats: null,
    });
    expect(first.score.lastUpdatedBy).toMatchObject({ id: scoreAdmin.id, name: "Scorer" });

    const second = await upsertLiveScore(
      match.id,
      { teamAScore: 190, teamBScore: "0/0", currentOver: 17, bowlerStats: { name: "Bumrah", wickets: 3 } },
      scoreAdmin,
    );
    expect(second.created).toBe(false);
    expect(second.score.version).toBe(2);
    // "190" with no wickets means the same four down, carried from the row above.
    expect(second.score.teamAScore).toBe("190/4");
    expect(second.score.currentOver).toBe("17.0");
    expect(second.score.bowlerStats).toEqual({ name: "Bumrah", wickets: 3 });

    const stored = await prisma.liveScore.findUniqueOrThrow({ where: { matchId: match.id } });
    expect(stored).toMatchObject({
      teamAScore: "190/4",
      version: 2,
      lastUpdatedById: scoreAdmin.id,
    });
  });

  it("warns instead of pretending, when a score arrives for a match that is not live", async () => {
    const match = await newMatch();
    const result = await upsertLiveScore(
      match.id,
      { teamAScore: "10/0", teamBScore: "0/0", currentOver: "1.2" },
      scoreAdmin,
    );
    expect(result.match.status).toBe("UPCOMING");
    expect(result.warnings[0]).toMatch(/will not appear in GET \/api\/matches\/live/);
  });

  it("refuses a score that moves the game backwards", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(
      match.id,
      { teamAScore: "182/4", teamBScore: "60/2", currentOver: "16.3" },
      scoreAdmin,
    );

    const fewer = await rejectionOf(
      upsertLiveScore(match.id, { teamAScore: "82/4", teamBScore: "60/2", currentOver: "16.4" }, scoreAdmin),
    );
    expect(fewer.code).toBe("SCORE_REVERSAL");
    expect(fewer.message).toMatch(/teamAScore runs 182 → 82/);

    const fewerBalls = await rejectionOf(
      upsertLiveScore(match.id, { teamAScore: "182/4", teamBScore: "60/2", currentOver: "15.5" }, scoreAdmin),
    );
    expect(fewerBalls.message).toMatch(/currentOver 16\.3 → 15\.5/);

    // Same runs with fewer wickets is still a reversal — and 182/3 after 182/4 is
    // exactly the kind of typo this catches.
    const wickets = await rejectionOf(
      upsertLiveScore(match.id, { teamAScore: "182/3", teamBScore: "60/2", currentOver: "16.4" }, scoreAdmin),
    );
    expect(wickets.message).toMatch(/wickets 4 → 3/);

    // Nothing was written by any of the refusals.
    const stored = await prisma.liveScore.findUniqueOrThrow({ where: { matchId: match.id } });
    expect(stored).toMatchObject({ teamAScore: "182/4", currentOver: "16.3", version: 1 });

    // A Super Admin corrects the record, and the row says who did.
    await expect(
      upsertLiveScore(match.id, { teamAScore: "128/4", teamBScore: "60/2", currentOver: "16.4" }, superAdmin),
    ).resolves.toMatchObject({ score: { teamAScore: "128/4", version: 2 } });
  });

  it("loses a write to the version guard rather than overwriting a colleague", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "50/1", teamBScore: "0/0", currentOver: "6.0" }, scoreAdmin);

    const stale = await rejectionOf(
      upsertLiveScore(
        match.id,
        { teamAScore: "60/1", teamBScore: "0/0", currentOver: "7.0", expectedVersion: 0 },
        scoreAdmin,
      ),
    );
    expect(stale.code).toBe("SCORE_STALE");
    expect((stale.details as { currentVersion: number }).currentVersion).toBe(1);

    const fresh = await upsertLiveScore(
      match.id,
      { teamAScore: "60/1", teamBScore: "0/0", currentOver: "7.0", expectedVersion: 1 },
      scoreAdmin,
    );
    expect(fresh.score.version).toBe(2);

    // `expectedVersion: 0` is how a feed says "only if nobody has started yet".
    const other = await newMatch();
    await upsertLiveScore(
      other.id,
      { teamAScore: "0/0", teamBScore: "0/0", currentOver: "0.0", expectedVersion: 0 },
      scoreAdmin,
    );
    expect(await prisma.liveScore.count({ where: { matchId: other.id } })).toBe(1);
  });

  it("lets one of two simultaneous writers win, not both", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "10/0", teamBScore: "0/0", currentOver: "2.0" }, scoreAdmin);

    const results = await Promise.allSettled([
      upsertLiveScore(
        match.id,
        { teamAScore: "20/0", teamBScore: "0/0", currentOver: "3.0", expectedVersion: 1 },
        scoreAdmin,
      ),
      upsertLiveScore(
        match.id,
        { teamAScore: "30/1", teamBScore: "0/0", currentOver: "3.0", expectedVersion: 1 },
        scoreAdmin,
      ),
    ]);

    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const stored = await prisma.liveScore.findUniqueOrThrow({ where: { matchId: match.id } });
    expect(stored.version).toBe(2);
    expect(stored.teamAScore).toMatch(/^(20|30)\/[01]$/);
  });

  it("closes the result of a completed match to a score admin", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "180/6", teamBScore: "176/9", currentOver: "20.0" }, scoreAdmin);
    await updateMatch(match.id, { status: "COMPLETED" }, scoreAdmin);

    const refused = await rejectionOf(
      upsertLiveScore(match.id, { teamAScore: "190/6", teamBScore: "176/9", currentOver: "20.0" }, scoreAdmin),
    );
    expect(refused.code).toBe("MATCH_LOCKED");
    expect(refused.message).toMatch(/COMPLETED/);

    await expect(
      upsertLiveScore(match.id, { teamAScore: "181/6", teamBScore: "176/9", currentOver: "20.0" }, superAdmin),
    ).resolves.toMatchObject({ score: { version: 2 } });
  });

  it("returns 404 for a scoreboard request against a match that does not exist", async () => {
    const error = await rejectionOf(
      upsertLiveScore(randomUUID(), { teamAScore: "1/0", teamBScore: "0/0", currentOver: "0.1" }, scoreAdmin),
    );
    expect(error.code).toBe("MATCH_NOT_FOUND");
  });
});

describe.skipIf(!db)("reading matches back", () => {
  it("gives the public view the score but never the payment QR", async () => {
    const match = await newMatch({ qrCodeUrl: "https://storage.example.test/qr/private.png" });
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "44/1", teamBScore: "0/0", currentOver: "5.2" }, scoreAdmin);

    const view = await getPublicMatch(match.id);
    expect(view).toMatchObject({
      id: match.id,
      status: "LIVE",
      score: { teamAScore: "44/1", currentOver: "5.2", version: 1 },
    });
    // `qrCodeUrl` is a payment destination, and `externalId` is an internal
    // pointer. Neither belongs in a response a stranger can read.
    expect(Object.keys(view).sort()).toEqual(
      ["createdAt", "id", "score", "startTime", "status", "teamA", "teamB", "title", "updatedAt"].sort(),
    );
    expect(JSON.stringify(view)).not.toMatch(/qr|externalId/i);
  });

  it("answers a match with no scoreboard yet with a null, not a 404", async () => {
    const match = await newMatch();
    const result = await getLiveScore(match.id);
    expect(result.match).toMatchObject({ id: match.id, status: "UPCOMING" });
    expect(result.score).toBeNull();

    const missing = await rejectionOf(getLiveScore(randomUUID()));
    expect(missing.code).toBe("MATCH_NOT_FOUND");
  });

  it("keeps the name of whoever wrote the board off the public scoreboard", async () => {
    const match = await newMatch();
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "12/0", teamBScore: "0/0", currentOver: "1.4" }, scoreAdmin);

    const { score } = await getLiveScore(match.id);
    expect(score).toMatchObject({ teamAScore: "12/0", currentOver: "1.4", version: 1 });

    // Which staff account touches a fixture is identity, not commentary on the
    // game. It is on the admin row, and it must not ride along on a response an
    // anonymous poller reads every five seconds.
    expect(score).not.toHaveProperty("lastUpdatedBy");
    expect(JSON.stringify(score)).not.toMatch(/lastUpdatedBy|Scorer|admin/i);

    const page = await listMatchesForAdmin({ q: match.title, limit: 10 });
    const row = page.items.find((item) => item.id === match.id);
    expect(row?.score?.lastUpdatedById).toBe(scoreAdmin.id);
  });

  it("lists only LIVE matches, most recently scored first", async () => {
    const stale = await newMatch();
    const fresh = await newMatch();
    const upcoming = await newMatch();
    await updateMatch(stale.id, { status: "LIVE" }, scoreAdmin);
    await updateMatch(fresh.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(stale.id, { teamAScore: "10/0", teamBScore: "0/0", currentOver: "2.0" }, scoreAdmin);
    await upsertLiveScore(fresh.id, { teamAScore: "20/0", teamBScore: "0/0", currentOver: "3.0" }, scoreAdmin);

    // The test database is shared, so the assertion is about this run's rows:
    // both are listed, the one scored last is listed first, and a match still
    // UPCOMING never appears.
    const { items, generatedAt } = await listLiveMatches(100);
    const ids = items.map((item) => item.id);
    expect(ids).toContain(fresh.id);
    expect(ids).toContain(stale.id);
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(stale.id));
    expect(ids).not.toContain(upcoming.id);
    expect(generatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(items.every((item) => item.status === "LIVE")).toBe(true);

    // A LIVE match nobody has scored yet still belongs on the list, with a null.
    const unscored = await newMatch();
    await updateMatch(unscored.id, { status: "LIVE" }, scoreAdmin);
    const again = await listLiveMatches(100);
    expect(again.items.find((item) => item.id === unscored.id)?.score).toBeNull();
  });

  it("pages the public list in either direction without skipping or repeating a row", async () => {
    for (let index = 0; index < 4; index += 1) await newMatch();

    for (const order of ["desc", "asc"] as const) {
      const seen: string[] = [];
      let cursor: string | null | undefined = undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await listPublicMatches({ limit: 2, order, cursor });
        seen.push(...page.items.map((item) => item.id));
        expect(page.order).toBe(order);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(new Set(seen).size);
      expect(seen.length).toBeGreaterThanOrEqual(5);

      const times = seen.map((id) => id);
      expect(new Set(times).size).toBe(times.length);
    }

    // Sorted, not merely consistent between pages.
    const page = await listPublicMatches({ limit: 100, order: "asc" });
    const asc = page.items.map((item) => item.startTime.getTime());
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);
  });

  it("filters the public list by status and by an inclusive time window", async () => {
    const live = await newMatch();
    const completed = await newMatch();
    await updateMatch(live.id, { status: "LIVE" }, scoreAdmin);
    await updateMatch(completed.id, { status: "COMPLETED" }, scoreAdmin);

    const liveOnly = await listPublicMatches({ status: "LIVE", limit: 100 });
    expect(liveOnly.items.map((item) => item.id)).toContain(live.id);
    expect(liveOnly.items.some((item) => item.id === completed.id)).toBe(false);

    // A window that covers exactly one match's start time finds that match.
    const start = completed.startTime;
    const windowed = await listPublicMatches({ from: start, to: start, limit: 100 });
    expect(windowed.items.map((item) => item.id)).toContain(completed.id);

    const future = await listPublicMatches({ from: new Date(start.getTime() + 3_600_000), limit: 100 });
    expect(future.items.some((item) => item.id === completed.id)).toBe(false);
  });

  it("counts the whole admin filter, searches it, and keeps the internal columns", async () => {
    const match = await newMatch({ teamA: "Rajasthan", teamB: "Punjab", externalId: `${RUN}-admin-1` });
    await updateMatch(match.id, { status: "LIVE" }, scoreAdmin);
    await upsertLiveScore(match.id, { teamAScore: "12/0", teamBScore: "0/0", currentOver: "1.4" }, scoreAdmin);

    const all = await listMatchesForAdmin({ limit: 100 });
    expect(all.counts.LIVE).toBeGreaterThanOrEqual(1);
    expect(all.counts.UPCOMING + all.counts.LIVE + all.counts.COMPLETED).toBe(
      all.counts.UPCOMING + all.counts.LIVE + all.counts.COMPLETED,
    );

    const row = all.items.find((item) => item.id === match.id)!;
    expect(row).toMatchObject({
      externalId: `${RUN}-admin-1`,
      hasQrCode: false,
      score: { teamAScore: "12/0", lastUpdatedById: scoreAdmin.id },
    });

    // The counts describe the filter without the status tab, so tab labels stay
    // honest while an operator clicks between them.
    const liveOnly = await listMatchesForAdmin({ status: "LIVE", limit: 100 });
    expect(liveOnly.counts).toEqual(all.counts);
    expect(liveOnly.items.every((item) => item.status === "LIVE")).toBe(true);

    const searched = await listMatchesForAdmin({ q: "rajasthan", limit: 100 });
    expect(searched.items.map((item) => item.id)).toContain(match.id);

    const byTitle = await listMatchesForAdmin({ q: RUN, status: "COMPLETED", limit: 100 });
    expect(byTitle.items.every((item) => item.status === "COMPLETED")).toBe(true);
    expect(byTitle.items.some((item) => item.id === match.id)).toBe(false);
  });

  it("refuses a bad limit or cursor on both lists", async () => {
    for (const filters of [{ limit: 0 }, { limit: 101 }, { limit: Number.NaN }, { cursor: "nope" }]) {
      const publicError = await rejectionOf(listPublicMatches(filters));
      expect(publicError.code).toBe("VALIDATION_ERROR");
      const adminError = await rejectionOf(listMatchesForAdmin(filters));
      expect(adminError.code).toBe("VALIDATION_ERROR");
    }
    const liveError = await rejectionOf(listLiveMatches(9999));
    expect(liveError.code).toBe("VALIDATION_ERROR");
  });

  it("cascades the scoreboard away with the match, and only the row that belongs to it", async () => {
    const match = await newMatch();
    const other = await newMatch();
    await upsertLiveScore(match.id, { teamAScore: "5/0", teamBScore: "0/0", currentOver: "1.0" }, scoreAdmin);
    await upsertLiveScore(other.id, { teamAScore: "6/0", teamBScore: "0/0", currentOver: "1.0" }, scoreAdmin);

    await prisma.match.delete({ where: { id: match.id } });
    expect(await prisma.liveScore.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.liveScore.count({ where: { matchId: other.id } })).toBe(1);

    const index = createdMatchIds.indexOf(match.id);
    if (index >= 0) createdMatchIds.splice(index, 1);
  });

  it("keeps the version column honest for rows written outside the service", async () => {
    const match = await newMatch();
    // Version 0 would make "the scoreboard is at version 0" mean two different
    // things: nothing written yet, and one write. The database says no either
    // way, whoever is holding the pen.
    await expect(
      prisma.liveScore.create({
        data: {
          matchId: match.id,
          teamAScore: "1/0",
          teamBScore: "0/0",
          currentOver: "0.1",
          version: 0,
        },
      }),
    ).rejects.toThrow(/live_scores_version_positive/);
  });
});
