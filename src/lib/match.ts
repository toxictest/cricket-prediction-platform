import { Prisma, type MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  externalUrlMessage,
  inspectExternalUrl,
  MAX_EXTERNAL_URL_LENGTH,
} from "@/lib/external-url";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeSortCursor,
  encodeSortCursor,
  resolveLimit,
} from "@/lib/pagination";

/* ==========================================================================
   MATCH SERVICE — FIXTURES AND THE LIVE SCOREBOARD
   ==========================================================================

   Who gets to say what a match is, and what the score is. Two different
   dangers, so two different rule sets:

     the fixture   — one match row, edited by admins, and the row the deposit QR
                     hangs off. A duplicate or a wrong start time is visible to
                     every member, so creation is guarded and identity edits
                     after play starts are escalated.
     the scoreboard — one row per match, written over and over while a game is
                     in progress, possibly by two people and a feed at once. So
                     it is versioned, and a write that would move the game
                     backwards is refused rather than trusted.

   Rules this module owns
   ----------------------
   1. `title`, `teamA` and `teamB` are normalised (trim, collapse inner
      whitespace) and a match may not name the same team twice.
   2. A match is identified, for duplicate purposes, by its two teams *and* its
      start time, in either team order. Two rows for one fixture means two
      scoreboards and one of them is a lie, so a repeat is 409.
   3. `externalId`, when present, is unique. A feed ingest must be re-runnable
      for one fixture without creating a second match.
   4. `qrCodeUrl` is either absent or a valid http(s) URL with no credentials
      and no internal host — the same rules as a payment proof link
      (src/lib/external-url.ts). It is never returned by a public endpoint: it
      is the address money is sent to.
   5. Identity edits (`title`, teams, `startTime`) after a match has been played
      need SUPER_ADMIN. So does moving the status backwards. A SCORE_ADMIN runs
      the scoreboard; a Super Admin is the one who rewrites history.
   6. Scores are stored in one canonical shape — `runs/wickets` and
      `overs.balls` — and a write may not lower a team's runs, its wickets or
      the overs bowled, because the usual reason for that is a stale tab, not a
      corrected score. SUPER_ADMIN overrides, with no flag needed.
   7. `version` increments on every accepted scoreboard write. A caller may pass
      `expectedVersion`; a mismatch is 409 and the caller re-reads instead of
      overwriting someone else's update.
   8. Reads are public and cacheable. Writes are admin-only, role-checked, and
      never cached.
   ========================================================================== */

export const MATCH_STATUSES = ["UPCOMING", "LIVE", "COMPLETED"] as const;

export const MAX_TITLE_LENGTH = 120;
export const MAX_TEAM_LENGTH = 60;
export const MAX_QR_URL_LENGTH = MAX_EXTERNAL_URL_LENGTH;
export const MAX_EXTERNAL_ID_LENGTH = 64;
export const MAX_STATS_KEYS = 12;
export const MAX_STATS_ENTRIES = 2;
export const MAX_STATS_JSON_LENGTH = 4096;

/** Runs and wickets per innings. 4 digits for runs covers any first-class score. */
const MAX_RUNS = 9_999;
const MAX_WICKETS = 10;
const MAX_OVERS = 99;

/** Anything outside this year range is a typo in a date field, not a fixture. */
const MIN_START_YEAR = 2000;
const MAX_START_YEAR = 2100;

const MAX_ID_LENGTH = 64;

/** How long a public response may be reused before a client should revalidate. */
export const SCORE_MAX_AGE_SECONDS = 5;
export const LIST_MAX_AGE_SECONDS = 15;

/** A match row and its scoreboard are written from more than one place. */
const MATCH_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/* ==========================================================================
   ERRORS
   ========================================================================== */

export type MatchErrorCode =
  | "VALIDATION_ERROR"
  | "MATCH_NOT_FOUND"
  | "DUPLICATE_MATCH"
  | "MATCH_LOCKED"
  | "SCORE_STALE"
  | "SCORE_REVERSAL";

const HTTP_STATUS_BY_CODE: Record<MatchErrorCode, number> = {
  VALIDATION_ERROR: 400,
  MATCH_NOT_FOUND: 404,
  DUPLICATE_MATCH: 409,
  MATCH_LOCKED: 409,
  SCORE_STALE: 409,
  SCORE_REVERSAL: 409,
};

/** Expected business or validation failure. Every route maps it through `matchErrorResponse`. */
export class MatchError extends Error {
  readonly code: MatchErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: MatchErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "MatchError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
    this.details = details;
  }
}

/* ==========================================================================
   TYPES
   ========================================================================== */

export type MatchActor = {
  id: string;
  /** SUPER_ADMIN may do the escalated things: rewrite a played fixture, move a status backwards. */
  isSuperAdmin: boolean;
};

export type NewMatch = {
  title: string;
  teamA: string;
  teamB: string;
  startTime: string | number | Date;
  qrCodeUrl?: string | null;
  externalId?: string | null;
};

export type MatchPatch = {
  title?: string;
  teamA?: string;
  teamB?: string;
  startTime?: string | number | Date;
  status?: MatchStatus;
  qrCodeUrl?: string | null;
  externalId?: string | null;
};

export type ScoreInput = {
  teamAScore: string | number;
  teamBScore: string | number;
  currentOver: string | number;
  batsmanStats?: unknown;
  bowlerStats?: unknown;
  /** Reject the write unless this matches the row's current version. */
  expectedVersion?: number;
};

/** The scoreboard as any reader sees it. `version` is what a writer sends back. */
export type ScoreView = {
  teamAScore: string;
  teamBScore: string;
  currentOver: string;
  batsmanStats: unknown;
  bowlerStats: unknown;
  version: number;
  updatedAt: Date;
};

/**
 * The same board plus who last wrote it, and that addition is why the two types
 * are separate. Which staff account edited a match is back-office identity: it
 * belongs on the admin route, and never on an endpoint an anonymous poller reads.
 */
export type AdminScoreView = ScoreView & {
  lastUpdatedBy: { id: string; name: string } | null;
};

/** The columns both audiences need. `qrCodeUrl` is admin-only, by design. */
const MATCH_SELECT = {
  id: true,
  title: true,
  teamA: true,
  teamB: true,
  startTime: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  liveScore: {
    select: {
      teamAScore: true,
      teamBScore: true,
      currentOver: true,
      version: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.MatchSelect;

const ADMIN_MATCH_SELECT = {
  ...MATCH_SELECT,
  qrCodeUrl: true,
  externalId: true,
  liveScore: {
    select: {
      teamAScore: true,
      teamBScore: true,
      currentOver: true,
      version: true,
      updatedAt: true,
      lastUpdatedById: true,
    },
  },
} as const satisfies Prisma.MatchSelect;

type MatchRow = Prisma.MatchGetPayload<{ select: typeof MATCH_SELECT }>;
type AdminMatchRow = Prisma.MatchGetPayload<{ select: typeof ADMIN_MATCH_SELECT }>;

/** Public match. A score summary travels with it so a list does not need N+1 reads. */
export type MatchView = {
  id: string;
  title: string;
  teamA: string;
  teamB: string;
  startTime: Date;
  status: MatchStatus;
  createdAt: Date;
  updatedAt: Date;
  score: {
    teamAScore: string;
    teamBScore: string;
    currentOver: string;
    version: number;
    updatedAt: Date;
  } | null;
};

export type AdminMatchView = MatchView & {
  qrCodeUrl: string | null;
  externalId: string | null;
  hasQrCode: boolean;
  score: (MatchView["score"] & { lastUpdatedById: string | null }) | null;
};

export type MatchPage<T> = {
  items: T[];
  /** Pass as `cursor` for the next page in the same direction. Null when done. */
  nextCursor: string | null;
  /** Which way `startTime` was walked, echoed so a client cannot mis-page. */
  order: "asc" | "desc";
};

export type MatchListFilters = {
  status?: MatchStatus;
  from?: Date;
  to?: Date;
  /** Newest-first (`desc`, the default) or soonest-first (`asc`). */
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
};

export type AdminMatchListFilters = MatchListFilters & {
  /** Case-insensitive substring of the title or either team. Admin-only: it is a scan. */
  q?: string;
};

/* ==========================================================================
   ADMIN: CREATE
   ========================================================================== */

/**
 * Creates a fixture. The status is always `UPCOMING` on arrival: a body that
 * could set `status: "LIVE"` would skip the transition rules that `updateMatch`
 * enforces, and a match that has not been played yet is not live. Use PATCH to
 * move it.
 */
export async function createMatch(
  input: NewMatch,
  actor: MatchActor,
): Promise<AdminMatchView> {
  const title = normalizeTitle(input.title);
  const teamA = normalizeTeamName(input.teamA, "teamA");
  const teamB = normalizeTeamName(input.teamB, "teamB");
  assertDistinctTeams(teamA, teamB);
  const startTime = normalizeStartTime(input.startTime);
  const qrCodeUrl = input.qrCodeUrl === undefined || input.qrCodeUrl === null
    ? null
    : normalizeQrCodeUrl(input.qrCodeUrl);
  const externalId = normalizeExternalId(input.externalId);

  await assertFixtureUnused({ teamA, teamB, startTime, externalId });

  try {
    const row = await prisma.match.create({
      data: { title, teamA, teamB, startTime, status: "UPCOMING", qrCodeUrl, externalId },
      select: ADMIN_MATCH_SELECT,
    });

    // The QR is where members send money for this match, so who attached which
    // one is worth a log line until AdminAuditLog exists.
    if (qrCodeUrl) {
      logQrChange(row.id, actor.id, qrCodeUrl, "attached");
    }
    return toAdminView(row);
  } catch (error) {
    if (isUniqueViolation(error, ["externalId"])) {
      throw new MatchError(
        "DUPLICATE_MATCH",
        `another match already uses externalId "${externalId}"`,
      );
    }
    throw error;
  }
}

/* ==========================================================================
   ADMIN: UPDATE
   ========================================================================== */

/**
 * Applies a partial update. Returns the row, the final status, and which fields
 * actually changed, so an admin UI that saves a whole form can tell a real edit
 * from a no-op.
 *
 * The escalated half of the rules — identity edits after play has started, and
 * backwards status moves — need SUPER_ADMIN. Everything else a SCORE_ADMIN may
 * do freely, including setting and clearing `qrCodeUrl`, which is the point of
 * the match-level QR (a new QR per match is the whole idea).
 */
export async function updateMatch(
  matchId: string,
  patch: MatchPatch,
  actor: MatchActor,
): Promise<AdminMatchView & { changed: string[] }> {
  const id = parseId(matchId);

  return prisma.$transaction(async (tx) => {
    const current = await lockMatch(tx, id);
    if (!current) throw notFound();

    const next = {
      title: patch.title === undefined ? current.title : normalizeTitle(patch.title),
      teamA: patch.teamA === undefined ? current.teamA : normalizeTeamName(patch.teamA, "teamA"),
      teamB: patch.teamB === undefined ? current.teamB : normalizeTeamName(patch.teamB, "teamB"),
      startTime:
        patch.startTime === undefined
          ? current.startTime
          : normalizeStartTime(patch.startTime),
      status: patch.status === undefined ? current.status : patch.status,
      qrCodeUrl:
        patch.qrCodeUrl === undefined
          ? current.qrCodeUrl
          : patch.qrCodeUrl === null
            ? null
            : normalizeQrCodeUrl(patch.qrCodeUrl),
      externalId:
        patch.externalId === undefined
          ? current.externalId
          : normalizeExternalId(patch.externalId),
    };

    assertDistinctTeams(next.teamA, next.teamB);

    const changed = diffFields(current, next);
    if (changed.length === 0) {
      // An admin form that saves unchanged values must not bump `updatedAt`,
      // because `updatedAt` is what the public ETag and the paging cursor lean on.
      const unchanged = await loadAdminMatch(tx, id);
      if (!unchanged) throw notFound();
      return { ...toAdminView(unchanged), changed: [] };
    }

    const touchedIdentity = changed.some((field) => IDENTITY_FIELDS.includes(field));
    if (touchedIdentity && hasBeenPlayed(current) && !actor.isSuperAdmin) {
      throw new MatchError(
        "MATCH_LOCKED",
        `This match has been played, so changing ${changed.filter((f) => IDENTITY_FIELDS.includes(f)).join(", ")} needs SUPER_ADMIN. A score admin may still update the scoreboard.`,
        { fields: changed.filter((f) => IDENTITY_FIELDS.includes(f)), status: current.status },
      );
    }

    if (current.status !== next.status && isBackward(current.status, next.status) && !actor.isSuperAdmin) {
      throw new MatchError(
        "MATCH_LOCKED",
        `Moving a match from ${current.status} back to ${next.status} needs SUPER_ADMIN, because predictions and settlement read this column.`,
        { from: current.status, to: next.status },
      );
    }

    if (changed.some((field) => ["teamA", "teamB", "startTime", "externalId"].includes(field))) {
      await assertFixtureUnused({
        teamA: next.teamA,
        teamB: next.teamB,
        startTime: next.startTime,
        externalId: next.externalId,
        exceptId: id,
        client: tx,
      });
    }

    const updated = await tx.match.update({
      where: { id },
      data: {
        title: next.title,
        teamA: next.teamA,
        teamB: next.teamB,
        startTime: next.startTime,
        status: next.status,
        qrCodeUrl: next.qrCodeUrl,
        externalId: next.externalId,
      },
      select: ADMIN_MATCH_SELECT,
    });

    if (changed.includes("qrCodeUrl")) {
      logQrChange(id, actor.id, next.qrCodeUrl, next.qrCodeUrl ? "replaced" : "cleared");
    }

    return { ...toAdminView(updated), changed };
  }, MATCH_TX_OPTIONS);
}

/** Fields whose meaning a scoreboard and a prediction depend on. */
const IDENTITY_FIELDS: string[] = ["title", "teamA", "teamB", "startTime"];

/* ==========================================================================
   ADMIN: THE SCOREBOARD
   ========================================================================== */

/**
 * Creates or updates the one scoreboard a match has.
 *
 *   lock the match → refuse a finished result unless SUPER_ADMIN → parse the
 *   scores → refuse a backwards move → bump `version` → write
 *
 * The match row is locked rather than the score row, so a scoreboard write and
 * a status change cannot interleave: while this transaction runs, `updateMatch`
 * waits, and the status it finally reads is the one the score was checked
 * against.
 *
 * `created` in the result says whether this was the match's first scoreboard.

 * `expectedVersion` is optional and advisory in the friendly sense: leave it out
 * and you are the last writer, send it and a lost race costs you a 409 with the
 * current version in `details` instead of a silently overwritten over.
 */
export async function upsertLiveScore(
  matchId: string,
  input: ScoreInput,
  actor: MatchActor,
): Promise<{ created: boolean; match: AdminMatchView; score: AdminScoreView; warnings: string[] }> {
  const id = parseId(matchId);

  const currentOver = normalizeOver(input.currentOver);
  const batsmanStats = normalizeStats(input.batsmanStats, "batsmanStats");
  const bowlerStats = normalizeStats(input.bowlerStats, "bowlerStats");
  const expectedVersion =
    input.expectedVersion === undefined ? null : normalizeVersion(input.expectedVersion);

  return prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, id);
    if (!match) throw notFound();

    if (match.status === "COMPLETED" && !actor.isSuperAdmin) {
      throw new MatchError(
        "MATCH_LOCKED",
        "This match is COMPLETED, so its result is closed to a score admin. A Super Admin can reopen the match or correct the score.",
      );
    }

    const previous = await tx.liveScore.findUnique({
      where: { matchId: id },
      select: {
        teamAScore: true,
        teamBScore: true,
        currentOver: true,
        version: true,
      },
    });

    // The bare-number forms mean "runs only", so wickets carry over from the row
    // being replaced. Parse after the read, on purpose: `45.2` and `45/2` both
    // need to know what the innings said a moment ago.
    const nextA = normalizeScore(input.teamAScore, "teamAScore", previous?.teamAScore);
    const nextB = normalizeScore(input.teamBScore, "teamBScore", previous?.teamBScore);

    if (expectedVersion !== null && (previous?.version ?? 0) !== expectedVersion) {
      throw new MatchError(
        "SCORE_STALE",
        previous
          ? `The scoreboard is at version ${previous.version}, not ${expectedVersion}. Re-read it and post again.`
          : "This match has no scoreboard yet, so expectedVersion must be 0.",
        { currentVersion: previous?.version ?? null },
      );
    }

    if (previous && !actor.isSuperAdmin) {
      const reversals = findReversals(previous, {
        teamAScore: nextA,
        teamBScore: nextB,
        currentOver,
      });
      if (reversals.length > 0) {
        throw new MatchError(
          "SCORE_REVERSAL",
          `A score cannot go backwards (${reversals.join(", ")}). A mis-keyed entry is corrected by a Super Admin, not by posting an older over.`,
          { reversals },
        );
      }
    }

    // A nullable `Json` column is cleared with `Prisma.DbNull`, not `null`: the
    // two mean different things to Prisma, and a stored JSON `null` would be
    // handed back to every reader as a value.
    const fields = {
      teamAScore: nextA,
      teamBScore: nextB,
      currentOver,
      batsmanStats: jsonOrNull(batsmanStats),
      bowlerStats: jsonOrNull(bowlerStats),
      lastUpdatedById: actor.id,
    };

    // `increment` is an update-only operator, so the first write of a match
    // states version 1 rather than asking for one to be added to nothing.
    const written = previous
      ? await tx.liveScore.update({
          where: { matchId: id },
          data: { ...fields, version: { increment: 1 } },
          select: SCORE_VIEW_SELECT,
        })
      : await tx.liveScore.create({
          data: { ...fields, matchId: id, version: 1 },
          select: SCORE_VIEW_SELECT,
        });

    const fresh = await loadAdminMatch(tx, id);
    if (!fresh) throw notFound();

    return {
      created: previous === null,
      match: toAdminView(fresh),
      score: toScoreView(written),
      warnings:
        match.status === "UPCOMING"
          ? [
              "the match is still UPCOMING, so it will not appear in GET /api/matches/live until its status moves to LIVE",
            ]
          : [],
    };
  }, MATCH_TX_OPTIONS);
}

/** Every field a scoreboard read needs, on either side of the admin line. */
const PUBLIC_SCORE_SELECT = {
  teamAScore: true,
  teamBScore: true,
  currentOver: true,
  batsmanStats: true,
  bowlerStats: true,
  version: true,
  updatedAt: true,
} as const satisfies Prisma.LiveScoreSelect;

/** The admin read adds one relation join. The public path never asks for it. */
const SCORE_VIEW_SELECT = {
  ...PUBLIC_SCORE_SELECT,
  lastUpdatedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.LiveScoreSelect;

type ScoreRow = Prisma.LiveScoreGetPayload<{ select: typeof PUBLIC_SCORE_SELECT }>;
type ScoreWithEditor = Prisma.LiveScoreGetPayload<{ select: typeof SCORE_VIEW_SELECT }>;

function toScoreView(row: ScoreWithEditor): AdminScoreView {
  return {
    teamAScore: row.teamAScore,
    teamBScore: row.teamBScore,
    currentOver: row.currentOver,
    batsmanStats: row.batsmanStats,
    bowlerStats: row.bowlerStats,
    version: row.version,
    updatedAt: row.updatedAt,
    lastUpdatedBy: row.lastUpdatedBy
      ? { id: row.lastUpdatedBy.id, name: row.lastUpdatedBy.name }
      : null,
  };
}

function toPublicScoreView(row: ScoreRow): ScoreView {
  return {
    teamAScore: row.teamAScore,
    teamBScore: row.teamBScore,
    currentOver: row.currentOver,
    batsmanStats: row.batsmanStats,
    bowlerStats: row.bowlerStats,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/* ==========================================================================
   READS — PUBLIC
   ========================================================================== */

/**
 * One public match with its scoreboard. Deliberately the same shape as a row in
 * `listPublicMatches`, so a client can render either without a second model.
 * No `qrCodeUrl`, ever: that link is a payment destination and it goes out
 * through `GET /api/payment/qr` to a signed-in member only.
 */
export async function getPublicMatch(matchId: string): Promise<MatchView> {
  const row = await prisma.match.findUnique({
    where: { id: parseId(matchId) },
    select: MATCH_SELECT,
  });
  if (!row) throw notFound();
  return toView(row);
}

/**
 * The scoreboard for one match, plus the few match fields a viewer needs to
 * label it. A match with no scoreboard yet answers `score: null` rather than
 * 404, because "no runs yet" is a real state a polling client must be able to
 * distinguish from "no such match" (which is the 404 this throws for).
 */
export async function getLiveScore(matchId: string): Promise<{
  match: { id: string; title: string; teamA: string; teamB: string; status: MatchStatus; startTime: Date };
  score: ScoreView | null;
}> {
  const row = await prisma.match.findUnique({
    where: { id: parseId(matchId) },
    select: {
      id: true,
      title: true,
      teamA: true,
      teamB: true,
      status: true,
      startTime: true,
      liveScore: { select: PUBLIC_SCORE_SELECT },
    },
  });
  if (!row) throw notFound();

  const { liveScore, ...match } = row;
  return { match, score: liveScore ? toPublicScoreView(liveScore) : null };
}

/**
 * What is being played right now, most recently scored first, so a match with
 * fresh action is at the top of a member's screen. Intentionally unpaged: a
 * platform with more than `limit` matches live at once has an ingestion problem
 * that a cursor will not help. `GET /api/matches?status=LIVE` is the paged form.
 */
export async function listLiveMatches(
  limit?: number,
): Promise<{ items: MatchView[]; generatedAt: Date }> {
  const size = resolveLimit(limit);
  if (size === null) {
    throw new MatchError("VALIDATION_ERROR", `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  }

  const rows = await prisma.match.findMany({
    where: { status: "LIVE" },
    orderBy: [{ liveScore: { updatedAt: "desc" } }, { startTime: "asc" }],
    take: size,
    select: MATCH_SELECT,
  });

  return { items: rows.map(toView), generatedAt: new Date() };
}

/** The public archive: every fixture, newest first by default. */
export async function listPublicMatches(
  filters: MatchListFilters = {},
): Promise<MatchPage<MatchView>> {
  const { size, order, after } = resolveMatchPage(filters);

  const rows = await prisma.match.findMany({
    where: { ...(filters.status ? { status: filters.status } : {}), ...timeWindow(filters) },
    orderBy: [{ startTime: order }, { id: order }],
    take: size + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: MATCH_SELECT,
  });

  return pageOfMatches(rows.map(toView), size, order);
}

/* ==========================================================================
   READS — ADMIN
   ========================================================================== */

/**
 * The console's list: same paging as the public one, plus the QR, the external
 * id, who last touched the scoreboard, a `q` substring search, and whole-filter
 * counts. `q` is a `LIKE` scan and lives only here on purpose — a public
 * endpoint with an unindexed free-text filter is a denial of service with a
 * search box attached.
 */
export async function listMatchesForAdmin(
  filters: AdminMatchListFilters = {},
): Promise<MatchPage<AdminMatchView> & { counts: Record<MatchStatus, number> }> {
  const { size, order, after } = resolveMatchPage(filters);
  // `baseWhere` is everything except the status tab, so the counts on the
  // response describe the queue the operator is actually standing in front of.
  const baseWhere: Prisma.MatchWhereInput = {
    ...timeWindow(filters),
    ...(filters.q ? searchWhere(filters.q) : {}),
  };
  const where: Prisma.MatchWhereInput = filters.status
    ? { ...baseWhere, status: filters.status }
    : baseWhere;

  const [rows, totals] = await Promise.all([
    prisma.match.findMany({
      where,
      orderBy: [{ startTime: order }, { id: order }],
      take: size + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: ADMIN_MATCH_SELECT,
    }),
    prisma.match.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const counts: Record<MatchStatus, number> = { UPCOMING: 0, LIVE: 0, COMPLETED: 0 };
  for (const row of totals) counts[row.status] = row._count._all;

  return { ...pageOfMatches(rows.map(toAdminView), size, order), counts };
}

/** Case-insensitive substring over the three names an operator would type. */
function searchWhere(q: string): Prisma.MatchWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { teamA: { contains: q, mode: "insensitive" } },
      { teamB: { contains: q, mode: "insensitive" } },
    ],
  };
}

/* ==========================================================================
   INTERNALS
   ========================================================================== */

type LockedMatch = {
  id: string;
  title: string;
  teamA: string;
  teamB: string;
  startTime: Date;
  status: MatchStatus;
  qrCodeUrl: string | null;
  externalId: string | null;
  hasScore: boolean;
};

/**
 * Row lock, and the only way this service reads a match before writing it. The
 * columns come back from one statement, so the status, the previous score and
 * the version a caller is told about all describe the same instant.
 */
async function lockMatch(tx: Prisma.TransactionClient, id: string): Promise<LockedMatch | null> {
  const rows = await tx.$queryRaw<LockedMatch[]>`
    SELECT m."id",
           m."title",
           m."team_a"          AS "teamA",
           m."team_b"          AS "teamB",
           m."start_time"      AS "startTime",
           m."status"::text    AS "status",
           m."qr_code_url"     AS "qrCodeUrl",
           m."external_id"     AS "externalId",
           (l."id" IS NOT NULL) AS "hasScore"
    FROM "matches" m
    LEFT JOIN "live_scores" l ON l."match_id" = m."id"
    WHERE m."id" = ${id}
    FOR UPDATE OF m
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, status: row.status as MatchStatus };
}

function loadAdminMatch(tx: Prisma.TransactionClient, id: string): Promise<AdminMatchRow | null> {
  return tx.match.findUnique({ where: { id }, select: ADMIN_MATCH_SELECT });
}

/** A fixture is "played" once it has left UPCOMING or once a scoreboard exists. */
function hasBeenPlayed(match: { status: MatchStatus; hasScore: boolean }): boolean {
  return match.status !== "UPCOMING" || match.hasScore;
}

function isBackward(from: MatchStatus, to: MatchStatus): boolean {
  const order: Record<MatchStatus, number> = { UPCOMING: 0, LIVE: 1, COMPLETED: 2 };
  return order[to] < order[from];
}

/**
 * Two rows for one fixture is the failure this guards: two scoreboards, and the
 * deposit QR chosen from whichever match the query happens to like. Teams are
 * compared in either order, because "A vs B" and "B vs A" are one game.
 */
async function assertFixtureUnused(guard: {
  teamA: string;
  teamB: string;
  startTime: Date;
  externalId: string | null;
  exceptId?: string;
  client?: Prisma.TransactionClient;
}): Promise<void> {
  // `PrismaClient` is structurally assignable to `Prisma.TransactionClient`, so
  // the guard reads on the caller's transaction when there is one and on the
  // pool when there is not.
  const db: Prisma.TransactionClient = guard.client ?? prisma;

  const clash = await db.match.findFirst({
    where: {
      startTime: guard.startTime,
      ...(guard.exceptId ? { id: { not: guard.exceptId } } : {}),
      OR: [
        { teamA: { equals: guard.teamA, mode: "insensitive" }, teamB: { equals: guard.teamB, mode: "insensitive" } },
        { teamA: { equals: guard.teamB, mode: "insensitive" }, teamB: { equals: guard.teamA, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (clash) {
    throw new MatchError(
      "DUPLICATE_MATCH",
      "A match with these two teams already exists at that start time. Fix the time or edit the existing match.",
      { existingId: clash.id },
    );
  }

  if (guard.externalId) {
    const taken = await db.match.findFirst({
      where: {
        externalId: guard.externalId,
        ...(guard.exceptId ? { id: { not: guard.exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new MatchError(
        "DUPLICATE_MATCH",
        `externalId "${guard.externalId}" is already used by another match`,
        { existingId: taken.id },
      );
    }
  }
}

function diffFields(
  current: LockedMatch,
  next: Omit<LockedMatch, "hasScore" | "id">,
): string[] {
  const changed: string[] = [];
  for (const field of ["title", "teamA", "teamB", "status", "qrCodeUrl", "externalId"] as const) {
    if (current[field] !== next[field]) changed.push(field);
  }
  if (current.startTime.getTime() !== next.startTime.getTime()) changed.push("startTime");
  return changed;
}

function toView(row: MatchRow): MatchView {
  const { liveScore, ...rest } = row;
  return {
    ...rest,
    score: liveScore
      ? {
          teamAScore: liveScore.teamAScore,
          teamBScore: liveScore.teamBScore,
          currentOver: liveScore.currentOver,
          version: liveScore.version,
          updatedAt: liveScore.updatedAt,
        }
      : null,
  };
}

function toAdminView(row: AdminMatchRow): AdminMatchView {
  const { liveScore, qrCodeUrl, ...rest } = row;
  return {
    ...rest,
    qrCodeUrl: qrCodeUrl ?? null,
    hasQrCode: qrCodeUrl !== null && qrCodeUrl !== undefined,
    score: liveScore
      ? {
          teamAScore: liveScore.teamAScore,
          teamBScore: liveScore.teamBScore,
          currentOver: liveScore.currentOver,
          version: liveScore.version,
          updatedAt: liveScore.updatedAt,
          lastUpdatedById: liveScore.lastUpdatedById ?? null,
        }
      : null,
  };
}

function notFound(): MatchError {
  return new MatchError("MATCH_NOT_FOUND", "Match not found");
}

function logQrChange(matchId: string, adminId: string, url: string | null, verb: string): void {
  let host = "none";
  if (url) {
    try {
      host = new URL(url).host;
    } catch {
      host = "unparseable";
    }
  }
  console.info(`[match] ${verb} qrCodeUrl for ${matchId} by admin ${adminId} (host: ${host})`);
}

function resolveMatchPage(filters: MatchListFilters): {
  size: number;
  order: "asc" | "desc";
  after: string | null;
} {
  const size = resolveLimit(filters.limit);
  if (size === null) {
    throw new MatchError("VALIDATION_ERROR", `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  }
  const order = filters.order === "asc" ? "asc" : "desc";

  if (filters.cursor === undefined || filters.cursor === null) return { size, order, after: null };
  const position = decodeSortCursor(filters.cursor);
  if (!position) throw new MatchError("VALIDATION_ERROR", "cursor is not valid");
  return { size, order, after: position.id };
}

function timeWindow(filters: MatchListFilters): Prisma.MatchWhereInput {
  if (!filters.from && !filters.to) return {};
  return {
    startTime: {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    },
  };
}

/**
 * Cursor paging on `(startTime, id)`. The cursor carries the sort column, so an
 * `asc` page and a `desc` page never hand each other a cursor that means the
 * opposite of what it should — the client's `order` is echoed back for the same
 * reason.
 */
function pageOfMatches<T extends { id: string; startTime: Date }>(
  rows: T[],
  size: number,
  order: "asc" | "desc",
): MatchPage<T> {
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  const last = items[items.length - 1];

  return {
    items,
    order,
    nextCursor: hasMore && last ? encodeSortCursor(last.startTime, last.id) : null,
  };
}

/* ==========================================================================
   VALIDATION
   ========================================================================== */

/** Trimmed and with inner whitespace collapsed, so "India  vs  Australia" is one string. */
export function normalizeTitle(value: string): string {
  if (typeof value !== "string") throw new MatchError("VALIDATION_ERROR", "title must be a string");
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new MatchError(
      "VALIDATION_ERROR",
      `title must be 3 to ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return trimmed;
}

export function normalizeTeamName(value: string, field: string): string {
  if (typeof value !== "string") throw new MatchError("VALIDATION_ERROR", `${field} must be a string`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > MAX_TEAM_LENGTH) {
    throw new MatchError("VALIDATION_ERROR", `${field} must be 1 to ${MAX_TEAM_LENGTH} characters`);
  }
  return trimmed;
}

function assertDistinctTeams(teamA: string, teamB: string): void {
  if (teamA.toLowerCase() === teamB.toLowerCase()) {
    throw new MatchError("VALIDATION_ERROR", "teamA and teamB must be two different teams");
  }
}

/** Accepts an ISO string, an epoch number or a Date. Everything else is a typo. */
export function normalizeStartTime(value: string | number | Date): Date {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(value.trim())
          : new Date(NaN);

  if (Number.isNaN(date.getTime())) {
    throw new MatchError("VALIDATION_ERROR", "startTime must be an ISO 8601 date-time");
  }
  const year = date.getUTCFullYear();
  if (year < MIN_START_YEAR || year > MAX_START_YEAR) {
    throw new MatchError(
      "VALIDATION_ERROR",
      `startTime must fall between ${MIN_START_YEAR} and ${MAX_START_YEAR}`,
    );
  }
  // `Timestamptz(3)` keeps milliseconds, so no rounding is needed here — but the
  // duplicate check compares this exact instant, so a caller sending
  // "2026-10-14T14:00:00Z" and one sending "2026-10-14T14:00:00.000Z" must reach
  // the same Date, which `new Date(...)` already guarantees.
  return date;
}

export function normalizeQrCodeUrl(value: string): string {
  const result = inspectExternalUrl(value, MAX_QR_URL_LENGTH);
  if (!result.ok) {
    throw new MatchError(
      "VALIDATION_ERROR",
      externalUrlMessage("qrCodeUrl", result.problem, MAX_QR_URL_LENGTH,
        "qrCodeUrl must point at your image host, not an internal address"),
    );
  }
  return result.href;
}

export function normalizeExternalId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new MatchError("VALIDATION_ERROR", "externalId must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new MatchError("VALIDATION_ERROR", `externalId must be at most ${MAX_EXTERNAL_ID_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Scores arrive as `"182/4"` or as a bare number of runs. The stored form is
 * always `runs/wickets`, because a column that can hold two shapes is a column
 * every reader has to guess about. A bare number carries the previous wickets
 * forward: "they scored 6 more" is the common update, and forcing the writer to
 * repeat `/4` is how stale wickets get typed in.
 */
export function normalizeScore(value: unknown, field: string, previous?: string): string {
  let runs: number;
  let wickets: number | null = null;

  if (typeof value === "number") {
    runs = value;
  } else if (typeof value === "string") {
    const text = value.trim().replace(/\s+/g, "");
    if (/^\d{1,4}$/.test(text)) {
      runs = Number(text);
    } else {
      const match = text.match(/^(\d{1,4})\/(\d{1,2})$/);
      if (!match) {
        throw new MatchError(
          "VALIDATION_ERROR",
          `${field} must be a score like 182/4, or a number of runs`,
        );
      }
      runs = Number(match[1]);
      wickets = Number(match[2]);
    }
  } else {
    throw new MatchError("VALIDATION_ERROR", `${field} must be a score like 182/4`);
  }

  if (!Number.isInteger(runs) || runs < 0 || runs > MAX_RUNS) {
    throw new MatchError("VALIDATION_ERROR", `${field} runs must be a whole number from 0 to ${MAX_RUNS}`);
  }

  if (wickets === null) {
    wickets = previous ? parseScoreParts(previous).wickets : 0;
  }
  if (wickets < 0 || wickets > MAX_WICKETS) {
    throw new MatchError("VALIDATION_ERROR", `${field} wickets must be 0 to ${MAX_WICKETS}`);
  }

  return `${runs}/${wickets}`;
}

/**
 * Overs, as `overs.balls`. The balls digit is capped at 5 because a sixth ball
 * ends the over: `16.6` is not a thing, and it is exactly what a scorer types
 * when they mean `17.0`. Refusing it is cheaper than explaining a scoreboard
 * that claims six legal balls in an over.
 */
export function normalizeOver(value: unknown): string {
  let overs: number;
  let balls: number;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new MatchError("VALIDATION_ERROR", "currentOver must be a number like 16.3");
    }
    overs = Math.floor(value);
    balls = Math.round(Math.round((value - overs) * 100) / 10);
  } else if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{1,2}$/.test(text)) {
      overs = Number(text);
      balls = 0;
    } else {
      const match = text.match(/^(\d{1,2})\.(\d)$/);
      if (!match) {
        throw new MatchError(
          "VALIDATION_ERROR",
          "currentOver must look like 16.3 (overs.balls, balls 0 to 5)",
        );
      }
      overs = Number(match[1]);
      balls = Number(match[2]);
    }
  } else {
    throw new MatchError("VALIDATION_ERROR", "currentOver must be a number or a string like 16.3");
  }

  if (overs < 0 || overs > MAX_OVERS) {
    throw new MatchError("VALIDATION_ERROR", `currentOver must be between 0.0 and ${MAX_OVERS}.5`);
  }
  if (balls < 0 || balls > 5) {
    throw new MatchError("VALIDATION_ERROR", "the balls part of currentOver must be 0 to 5 — a sixth ball ends the over");
  }

  return `${overs}.${balls}`;
}

/**
 * Batting and bowling figures are a display blob, not a table: the columns stay
 * JSON so a provider can add a field without a migration. Bounded instead of
 * typed — plain objects, scalars only, a key allowlist per entry, and a size cap
 * — because the failure this prevents is someone storing a megabyte in a column
 * every member polls for.
 */
export function normalizeStats(value: unknown, field: string): unknown {
  if (value === undefined || value === null) return null;

  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0 || entries.length > MAX_STATS_ENTRIES) {
    throw new MatchError("VALIDATION_ERROR", `${field} must be one object or up to ${MAX_STATS_ENTRIES}`);
  }

  const knownNumbers = new Set([
    "runs",
    "balls",
    "fours",
    "sixes",
    "strikeRate",
    "overs",
    "maidens",
    "wickets",
    "economy",
    "dots",
    "extras",
  ]);

  const cleaned = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new MatchError("VALIDATION_ERROR", `${field} entries must be objects of scalar values`);
    }
    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length === 0 || keys.length > MAX_STATS_KEYS) {
      throw new MatchError(
        "VALIDATION_ERROR",
        `${field} entries must have 1 to ${MAX_STATS_KEYS} fields`,
      );
    }

    const out: Record<string, string | number | boolean> = {};
    for (const key of keys) {
      const raw = (entry as Record<string, unknown>)[key];
      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) throw new MatchError("VALIDATION_ERROR", `${field}.${key} must be finite`);
        out[key] = Math.round(raw * 100) / 100;
      } else if (typeof raw === "boolean") {
        out[key] = raw;
      } else if (typeof raw === "string") {
        const text = raw.trim();
        // A feed sends numbers as strings. Storing "48" for runs means every
        // reader has to decide whether it is a count or a label.
        if (knownNumbers.has(key) && /^-?\d+(\.\d+)?$/.test(text)) {
          out[key] = Math.round(Number(text) * 100) / 100;
        } else {
          if (text.length > 60) {
            throw new MatchError("VALIDATION_ERROR", `${field}.${key} must be at most 60 characters`);
          }
          out[key] = text;
        }
      } else {
        throw new MatchError("VALIDATION_ERROR", `${field}.${key} must be a string, number or boolean`);
      }
    }
    return out;
  });

  const single = !Array.isArray(value) && cleaned.length === 1 ? cleaned[0] : cleaned;
  if (JSON.stringify(single).length > MAX_STATS_JSON_LENGTH) {
    throw new MatchError("VALIDATION_ERROR", `${field} is too large`);
  }
  return single;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** `true` when the incoming score is lower than the stored one, in either part. */
function findReversals(
  previous: { teamAScore: string; teamBScore: string; currentOver: string },
  next: { teamAScore: string; teamBScore: string; currentOver: string },
): string[] {
  const problems: string[] = [];

  for (const field of ["teamAScore", "teamBScore"] as const) {
    const before = parseScoreParts(previous[field]);
    const after = parseScoreParts(next[field]);
    if (after.runs < before.runs) problems.push(`${field} runs ${before.runs} → ${after.runs}`);
    else if (after.runs === before.runs && after.wickets < before.wickets) {
      problems.push(`${field} wickets ${before.wickets} → ${after.wickets}`);
    }
  }

  if (overToBalls(next.currentOver) < overToBalls(previous.currentOver)) {
    problems.push(`currentOver ${previous.currentOver} → ${next.currentOver}`);
  }
  return problems;
}

function parseScoreParts(value: string): { runs: number; wickets: number } {
  const match = value.match(/^(\d{1,4})\/(\d{1,2})$/);
  if (!match) return { runs: 0, wickets: 0 };
  return { runs: Number(match[1]), wickets: Number(match[2]) };
}

function overToBalls(value: string): number {
  const [overs, balls] = value.split(".");
  return Number(overs) * 6 + Number(balls ?? 0);
}

function normalizeVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MatchError("VALIDATION_ERROR", "expectedVersion must be a whole number of 0 or more");
  }
  return value;
}

function parseId(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new MatchError("VALIDATION_ERROR", `match id must be 1 to ${MAX_ID_LENGTH} characters`);
  }
  return trimmed;
}

function isUniqueViolation(error: unknown, fields: string[]): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta?.target as string[]).every((column) => fields.includes(column))
  );
}

/** Re-exported so the HTTP layer and the admin UI page the same way as this service. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
