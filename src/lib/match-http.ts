import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError } from "@/types";
import { apiJson, logApiError } from "@/lib/http";
import { MAX_PAGE_SIZE } from "@/lib/pagination";
import { MATCH_STATUSES, MatchError, type MatchActor, type MatchErrorCode } from "@/lib/match";

/* ==========================================================================
   HTTP LAYER FOR THE MATCH ENDPOINTS
   ==========================================================================

   Query and body parsing, error mapping, and the ETag maths that lets a member
   poll a scoreboard every few seconds without the server re-serialising the same
   JSON each time.

   The parsers check *shape* only. A score, an over and a team name are the
   service's business (`src/lib/match.ts`), because the same rules have to hold
   for a feed ingest job that never touches HTTP.
   ========================================================================== */

export type MatchApiError = {
  ok: false;
  error: string;
  code: MatchErrorCode | ApiError["code"];
  details?: unknown;
};

export function matchErrorResponse(error: unknown): NextResponse {
  if (error instanceof MatchError) {
    return apiJson(
      {
        ok: false,
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      } satisfies MatchApiError,
      error.status,
    );
  }

  // Logged here, not left to `guardRoute`: this catch is what turns a bug into a
  // 500, so it is also the last place that still knows the error was thrown.
  logApiError("match", error);
  const body: MatchApiError = {
    ok: false,
    error: "Something went wrong. Please try again.",
    code: "INTERNAL_ERROR",
  };
  return apiJson(body, 500);
}

/* ==========================================================================
   QUERY PARSING
   ========================================================================== */

const querySchema = z.object({
  status: z.enum(MATCH_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(200).optional(),
  q: z.string().trim().min(2).max(80).optional(),
});

export type MatchQuery = {
  status?: (typeof MATCH_STATUSES)[number];
  from?: Date;
  to?: Date;
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  q?: string;
};

export type MatchQueryResult = { ok: true; data: MatchQuery } | { ok: false; response: NextResponse };

/**
 * `?status=&from=&to=&order=&limit=&cursor=` — plus `?q=` where searching is
 * allowed. `q` is refused rather than ignored on a public route: it is a `LIKE`
 * scan, and an anonymous caller must not be able to discover that.
 */
export function parseMatchQuery(
  params: URLSearchParams,
  options: { allowSearch: boolean },
): MatchQueryResult {
  const raw = {
    status: params.get("status") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    order: params.get("order") ?? undefined,
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    // An empty search box is "no search", not an error: a form that submits
    // `?q=` should get the unfiltered list back.
    q: params.get("q")?.trim() || undefined,
  };

  if (!options.allowSearch && raw.q !== undefined) {
    const body: MatchApiError = {
      ok: false,
      error: "Search is available on the admin match list only",
      code: "VALIDATION_ERROR",
      details: { fieldErrors: { q: ["q is not accepted here"] } },
    };
    return { ok: false, response: apiJson(body, 400) };
  }

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    const body: MatchApiError = {
      ok: false,
      error: "Invalid query parameters",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    };
    return { ok: false, response: apiJson(body, 400) };
  }

  // `?to=2026-10-14` means *that day* to the person who typed it, so a date-only
  // upper bound is widened to the end of it. Without this, a report asking for
  // "matches up to today" quietly drops every match after midnight UTC.
  const to =
    parsed.data.to && DATE_ONLY.test(String(raw.to))
      ? new Date(parsed.data.to.getTime() + DAY_MS - 1)
      : parsed.data.to;

  return { ok: true, data: { ...parsed.data, from: parsed.data.from, to } };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/* ==========================================================================
   BODY PARSING
   ========================================================================== */

const startTimeField = z.union([
  z.string().trim().min(4).max(64),
  z.number(),
]);

const createSchema = z
  .object({
    title: z.string().min(1).max(500),
    teamA: z.string().min(1).max(200),
    teamB: z.string().min(1).max(200),
    startTime: startTimeField,
    qrCodeUrl: z.string().min(1).max(4096).nullish(),
    externalId: z.string().min(1).max(200).nullish(),
  })
  // `status` is absent on purpose: a create that could set it would skip the
  // transition rules in `updateMatch`, and `tokensToCredit` taught this app what
  // a client-supplied server-owned field costs.
  .strict();

const patchSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    teamA: z.string().min(1).max(200).optional(),
    teamB: z.string().min(1).max(200).optional(),
    startTime: startTimeField.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    qrCodeUrl: z.string().min(1).max(4096).nullish(),
    externalId: z.string().min(1).max(200).nullish(),
  })
  .strict()
  // "At least one field *with a value*", not "at least one key": a caller that
  // sends every field as undefined is sending an empty patch, and an empty patch
  // is worth an explicit 400 rather than a 200 that changed nothing.
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field to change",
  });

const scoreSchema = z
  .object({
    teamAScore: z.union([z.string().min(1).max(32), z.number()]),
    teamBScore: z.union([z.string().min(1).max(32), z.number()]),
    currentOver: z.union([z.string().min(1).max(16), z.number()]),
    // Shapes are the service's call: these are display blobs, bounded there
    // rather than pinned to a fixed key list here.
    batsmanStats: z.unknown().optional(),
    bowlerStats: z.unknown().optional(),
    expectedVersion: z.coerce.number().int().min(0).optional(),
  })
  .strict();

type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function invalidBody(details: unknown): NextResponse {
  const body: MatchApiError = {
    ok: false,
    error: "Invalid request body",
    code: "VALIDATION_ERROR",
    details,
  };
  return apiJson(body, 400);
}

export function parseCreateMatchBody(data: unknown): ParsedBody<z.infer<typeof createSchema>> {
  const parsed = createSchema.safeParse(data);
  if (!parsed.success) return { ok: false, response: invalidBody(parsed.error.flatten()) };
  return { ok: true, data: parsed.data };
}

export function parsePatchMatchBody(data: unknown): ParsedBody<z.infer<typeof patchSchema>> {
  const parsed = patchSchema.safeParse(data);
  if (!parsed.success) return { ok: false, response: invalidBody(parsed.error.flatten()) };
  return { ok: true, data: parsed.data };
}

export function parseScoreBody(data: unknown): ParsedBody<z.infer<typeof scoreSchema>> {
  const parsed = scoreSchema.safeParse(data);
  if (!parsed.success) return { ok: false, response: invalidBody(parsed.error.flatten()) };
  return { ok: true, data: parsed.data };
}

/* ==========================================================================
   CACHING
   ========================================================================== */

/**
 * A weak ETag over the parts of a response that would make a cached copy wrong:
 * the scoreboard's version, when it last moved, and the match status.
 *
 * `version` is inside the tag, so two different states of the same match can
 * never hash alike — the collision worry that normally comes with a 32-bit hash
 * does not apply to "is this the copy I already have".
 */
export function buildEtag(input: {
  version: number | null;
  updatedAt: Date | null;
  status: string;
  extra?: string;
}): string {
  const seed = `${input.version ?? "-"}|${input.updatedAt ? input.updatedAt.getTime() : "-"}|${input.status}${
    input.extra ? `|${input.extra}` : ""
  }`;
  return `W/"${fnv1a(seed).toString(36)}-${seed.length.toString(36)}"`;
}

/**
 * ETag for a list of matches: the newest change in the page, the statuses and
 * scoreboard versions it holds, and how many rows. A page that gained a row,
 * lost its score, or moved a live score gets a different tag; an identical page
 * gets the same one.
 *
 * Versions are in the input, not just timestamps, because a scoreboard can be
 * replaced within the same millisecond the page was built — and that is exactly
 * the moment a poller must not be told "you already have this".
 */
export function etagForMatchPage(
  items: { status: string; updatedAt: Date; score: { version: number; updatedAt: Date } | null }[],
): string {
  let newest = 0;
  for (const item of items) {
    newest = Math.max(newest, item.updatedAt.getTime(), item.score?.updatedAt.getTime() ?? 0);
  }
  return buildEtag({
    version: null,
    updatedAt: newest ? new Date(newest) : null,
    status: items.length > 0 ? items.map((item) => item.status).join("") : "EMPTY",
    extra: `${items.length}:${items.map((item) => item.score?.version ?? 0).join(",")}`,
  });
}

/**
 * `If-None-Match` comparison. Handles a list of candidates and the `W/` prefix on
 * either side, which is what a browser and a CDN both send back.
 */
export function isNotModified(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;

  const ours = stripWeak(etag);
  return header
    .split(",")
    .map((candidate) => stripWeak(candidate.trim()))
    .includes(ours);
}

function stripWeak(value: string): string {
  return value.replace(/^W\//, "");
}

/** FNV-1a. Small, dependency-free, and good enough to label a cached response. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Headers for a cacheable public read, with its ETag. */
export function publicCacheHeaders(etag: string, maxAgeSeconds: number): Record<string, string> {
  return {
    "Cache-Control": `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${
      maxAgeSeconds * 4
    }, stale-if-error=300`,
    ETag: etag,
  };
}

/** 304 with no body. The ETag must be echoed, or a client cannot match it later. */
export function notModifiedResponse(etag: string, maxAgeSeconds: number): NextResponse {
  return new NextResponse(null, { status: 304, headers: publicCacheHeaders(etag, maxAgeSeconds) });
}

/* ==========================================================================
   THE ACTOR
   ========================================================================== */

/**
 * Turns a guard principal into what the service needs to know: who is writing,
 * and whether they are allowed to do the escalated things (rewrite a played
 * fixture, move a status backwards, correct a score that already moved on).
 *
 * It is a role check inside the service rather than a second `requireAdmin`
 * because the rule is per-field. A score admin may change the QR on tonight's
 * match and may not change which teams are playing in a match that has been
 * played, and no route-level role list can express that.
 */
export function toMatchActor(admin: { id: string; roles: readonly string[] }): MatchActor {
  return { id: admin.id, isSuperAdmin: admin.roles.includes("SUPER_ADMIN") };
}
