import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchError } from "@/lib/match";
import {
  buildEtag,
  etagForMatchPage,
  isNotModified,
  matchErrorResponse,
  notModifiedResponse,
  parseCreateMatchBody,
  parseMatchQuery,
  parsePatchMatchBody,
  parseScoreBody,
  publicCacheHeaders,
  toMatchActor,
} from "@/lib/match-http";
import { SCORE_MAX_AGE_SECONDS } from "@/lib/match";

/**
 * Pure tests for the match HTTP layer: the envelope an admin or a member reads,
 * what the query string may and may not contain, the three body shapes, and the
 * ETag maths behind a polled scoreboard.
 */

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const query = (search: string, allowSearch = true) =>
  parseMatchQuery(new URL(`http://localhost/api/admin/matches${search}`).searchParams, { allowSearch });

/* ==========================================================================
   ERROR MAPPING
   ========================================================================== */

describe("matchErrorResponse", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["MATCH_NOT_FOUND", 404],
    ["DUPLICATE_MATCH", 409],
    ["MATCH_LOCKED", 409],
    ["SCORE_STALE", 409],
    ["SCORE_REVERSAL", 409],
  ] as const)("maps %s to %i", async (code, status) => {
    const response = matchErrorResponse(new MatchError(code, `message for ${code}`));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(bodyOf(response)).resolves.toEqual({
      ok: false,
      error: `message for ${code}`,
      code,
    });
  });

  it("carries details through, because SCORE_STALE is only useful with the current version", async () => {
    const response = matchErrorResponse(
      new MatchError("SCORE_STALE", "the scoreboard moved", { currentVersion: 7 }),
    );
    await expect(bodyOf(response)).resolves.toMatchObject({
      code: "SCORE_STALE",
      details: { currentVersion: 7 },
    });
  });

  it("reports anything unexpected as 500 without leaking it", async () => {
    const response = matchErrorResponse(new Error("connection pool exploded"));
    expect(response.status).toBe(500);
    await expect(bodyOf(response)).resolves.toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    });
    // One argument, redacted text, message included: what `logApiError` promises.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(
      /^\[match\] unhandled error: Error: connection pool exploded/,
    );
  });
});

/* ==========================================================================
   QUERY PARSING
   ========================================================================== */

describe("parseMatchQuery", () => {
  it("accepts the whole filter set", async () => {
    const result = await query(
      "?status=LIVE&from=2026-10-01&to=2026-10-31&order=asc&limit=50&cursor=abc&q=kings",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("LIVE");
    expect(result.data.order).toBe("asc");
    expect(result.data.limit).toBe(50);
    expect(result.data.cursor).toBe("abc");
    expect(result.data.q).toBe("kings");
    expect(result.data.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("widens a date-only upper bound to the end of that day", async () => {
    const result = await query("?to=2026-10-14");
    if (!result.ok) throw new Error("expected the query to parse");
    expect(result.data.to?.toISOString()).toBe("2026-10-14T23:59:59.999Z");

    // An exact timestamp is taken literally, so a report can cut mid-day.
    const exact = await query("?to=2026-10-14T09:00:00Z");
    if (!exact.ok) throw new Error("expected the query to parse");
    expect(exact.data.to?.toISOString()).toBe("2026-10-14T09:00:00.000Z");

    const from = await query("?from=2026-10-14");
    if (!from.ok) throw new Error("expected the query to parse");
    expect(from.data.from?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });

  it("treats an empty search box as no search", async () => {
    const result = await query("?q=");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.q).toBeUndefined();
  });

  it.each(["?status=PLAYING", "?limit=0", "?limit=101", "?limit=many", "?order=sideways", "?from=yesterday", "?cursor=", "?cursor=" + "x".repeat(201)])(
    "rejects %s with a 400 and field details",
    async (search) => {
      const result = await query(search);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(bodyOf(result.response)).resolves.toMatchObject({
          ok: false,
          code: "VALIDATION_ERROR",
          error: "Invalid query parameters",
        });
      }
    },
  );

  it("refuses ?q= on a public route instead of ignoring it", async () => {
    const result = await query("?q=kings", false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(bodyOf(result.response)).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Search is available on the admin match list only",
    });

    // Everything else a public caller may send is still fine there.
    expect((await query("?status=LIVE&limit=10", false)).ok).toBe(true);
  });
});

/* ==========================================================================
   BODY PARSING
   ========================================================================== */

describe("parseCreateMatchBody", () => {
  const valid = {
    title: "India vs Australia, 3rd T20I",
    teamA: "India",
    teamB: "Australia",
    startTime: "2026-10-14T14:00:00Z",
  };

  it("accepts the fields a fixture is made of", () => {
    const result = parseCreateMatchBody({ ...valid, qrCodeUrl: "https://storage.example.test/qr.png" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ...valid, qrCodeUrl: "https://storage.example.test/qr.png" });
  });

  it("accepts a start time as a string or an epoch, and a QR of null", () => {
    expect(parseCreateMatchBody({ ...valid, startTime: 1_760_000_000_000 }).ok).toBe(true);
    expect(parseCreateMatchBody({ ...valid, qrCodeUrl: null }).ok).toBe(true);
    expect(parseCreateMatchBody({ ...valid, externalId: null }).ok).toBe(true);
  });

  it("refuses server-owned and not-yet-owned fields", async () => {
    for (const body of [
      { ...valid, status: "LIVE" },
      { ...valid, id: "cuid-i-made-up" },
      { ...valid, createdAt: "2020-01-01" },
      { ...valid, lastUpdatedById: "admin-1" },
      { ...valid, qrCodeUrl: "" },
      { ...valid, teamC: "Third" },
      { ...valid, startTime: true },
      { ...valid, startTime: {} },
    ]) {
      const result = parseCreateMatchBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(bodyOf(result.response)).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
      }
    }
    expect(parseCreateMatchBody(valid).ok).toBe(true);
  });

  it("leaves value rules to the service, but not type rules", () => {
    // "1/0" is not a start time, and the service says why; the parser only knows
    // it is not a string or a number.
    expect(parseCreateMatchBody({ ...valid, startTime: 0 }).ok).toBe(true);
    expect(parseCreateMatchBody({ ...valid, startTime: "the evening" }).ok).toBe(true);
    expect(parseCreateMatchBody({ ...valid, startTime: null }).ok).toBe(false);
    expect(parseCreateMatchBody(null).ok).toBe(false);
  });
});

describe("parsePatchMatchBody", () => {
  it("accepts any one field, including a clear", () => {
    for (const body of [
      { status: "LIVE" },
      { qrCodeUrl: null },
      { externalId: null },
      { title: "New title" },
      { startTime: "2026-11-01T10:00:00Z" },
      { teamA: " renamed " },
    ]) {
      expect(parsePatchMatchBody(body).ok).toBe(true);
    }
  });

  it("refuses a body with nothing in it, rather than pretending to save", async () => {
    // An empty object and an object of undefined values are both "no patch", and
    // both say so in words the caller can act on.
    for (const body of [{}, { status: undefined }]) {
      const result = parsePatchMatchBody(body);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.response.status).toBe(400);
      await expect(bodyOf(result.response)).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { formErrors: ["Send at least one field to change"] },
      });
    }

    // Anything that is not an object at all is refused too, with zod's own reason.
    for (const body of [null, "status=LIVE", 42]) {
      const result = parsePatchMatchBody(body);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses unknown and immutable fields", () => {
    expect(parsePatchMatchBody({ id: "x", title: "y" }).ok).toBe(false);
    expect(parsePatchMatchBody({ liveScore: { teamAScore: "99/9" } }).ok).toBe(false);
    expect(parsePatchMatchBody({ status: "ABANDONED" }).ok).toBe(false);
    expect(parsePatchMatchBody({ score: "1/0" }).ok).toBe(false);
  });
});

describe("parseScoreBody", () => {
  const valid = { teamAScore: "182/4", teamBScore: "60/2", currentOver: "16.3" };

  it("accepts both shapes for each number, and either stats style", () => {
    expect(parseScoreBody(valid).ok).toBe(true);
    expect(parseScoreBody({ teamAScore: 182, teamBScore: 60, currentOver: 16.3 }).ok).toBe(true);
    expect(
      parseScoreBody({
        ...valid,
        batsmanStats: [{ name: "A" }, { name: "B" }],
        bowlerStats: { name: "C" },
        expectedVersion: 4,
      }).ok,
    ).toBe(true);
  });

  it("coerces a numeric expectedVersion from a form, and refuses a nonsense one", () => {
    const result = parseScoreBody({ ...valid, expectedVersion: "3" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.expectedVersion).toBe(3);

    for (const expectedVersion of [-1, 1.5, "soon"]) {
      expect(parseScoreBody({ ...valid, expectedVersion }).ok).toBe(false);
    }
  });

  it("refuses fields that are not the scoreboard's to set", () => {
    for (const body of [
      { ...valid, matchId: "someone-elses-match" },
      { ...valid, version: 99 },
      { ...valid, lastUpdatedById: "admin-i-trust" },
      { ...valid, status: "COMPLETED" },
      { ...valid, teamCScore: "1/0" },
    ]) {
      expect(parseScoreBody(body).ok).toBe(false);
    }
  });

  it("requires all three score fields on every write", () => {
    expect(parseScoreBody({ teamAScore: "1/0", teamBScore: "0/0" }).ok).toBe(false);
    expect(parseScoreBody({ teamAScore: "1/0", currentOver: "0.1" }).ok).toBe(false);
    expect(parseScoreBody({}).ok).toBe(false);
  });
});

/* ==========================================================================
   THE ACTOR
   ========================================================================== */

describe("toMatchActor", () => {
  it("recognises the escalated role and only that role", () => {
    expect(toMatchActor({ id: "a1", roles: ["SCORE_ADMIN"] })).toEqual({
      id: "a1",
      isSuperAdmin: false,
    });
    expect(toMatchActor({ id: "a2", roles: ["SUPER_ADMIN", "PAYMENT_ADMIN"] })).toEqual({
      id: "a2",
      isSuperAdmin: true,
    });
    expect(toMatchActor({ id: "a3", roles: [] }).isSuperAdmin).toBe(false);
  });
});

/* ==========================================================================
   CACHING
   ========================================================================== */

describe("ETag handling", () => {
  const at = (iso: string) => new Date(iso);

  it("is stable for one state and different for the next", () => {
    const base = { version: 3, updatedAt: at("2026-10-11T10:00:00Z"), status: "LIVE" };
    expect(buildEtag(base)).toBe(buildEtag({ ...base }));
    expect(buildEtag(base)).not.toBe(buildEtag({ ...base, version: 4 }));
    expect(buildEtag(base)).not.toBe(buildEtag({ ...base, status: "COMPLETED" }));
    expect(buildEtag(base)).not.toBe(buildEtag({ ...base, updatedAt: at("2026-10-11T10:00:01Z") }));
    expect(buildEtag({ version: null, updatedAt: null, status: "EMPTY" })).toBe(
      buildEtag({ version: null, updatedAt: null, status: "EMPTY" }),
    );
  });

  it("carries the version inside the tag, so two states of one match cannot collide", () => {
    const withVersion = buildEtag({ version: 1, updatedAt: at("2026-10-11T10:00:00Z"), status: "LIVE" });
    expect(withVersion).toMatch(/^W\/".+"$/);
  });

  it("matches a bare tag, a weak tag on either side, and a list", () => {
    const etag = 'W/"abc-10"';
    expect(isNotModified('"abc-10"', etag)).toBe(true);
    expect(isNotModified(etag, etag)).toBe(true);
    expect(isNotModified('"other","abc-10"', etag)).toBe(true);
    expect(isNotModified("*", etag)).toBe(true);
    expect(isNotModified('"abc-11"', etag)).toBe(false);
    expect(isNotModified(null, etag)).toBe(false);
  });

  it("labels a page by what changed in it, not by which rows were asked for", () => {
    const row = {
      id: "m1",
      status: "LIVE" as const,
      updatedAt: at("2026-10-11T10:00:00Z"),
      score: { version: 1, updatedAt: at("2026-10-11T10:00:00Z") },
    };
    const items = Array.from({ length: 2 }, (_, index) => ({ ...row, id: `m${index}` }));
    expect(etagForMatchPage(items)).toBe(etagForMatchPage(items));
    expect(etagForMatchPage([])).not.toBe(etagForMatchPage(items));
    // Losing a scoreboard changes the tag, even though no timestamp moved.
    expect(etagForMatchPage([{ ...items[0]!, score: null }])).not.toBe(etagForMatchPage([items[0]!]));
    expect(etagForMatchPage([{ ...items[0]!, score: { version: 2, updatedAt: items[0]!.score!.updatedAt } }])).not.toBe(
      etagForMatchPage([items[0]!]),
    );
    expect(etagForMatchPage([{ ...items[0]!, updatedAt: at("2026-10-11T11:00:00Z") }, items[1]!])).not.toBe(
      etagForMatchPage(items),
    );
  });

  it("sets cache headers on a public read and no-store on a refusal", async () => {
    const headers = publicCacheHeaders('W/"abc-10"', SCORE_MAX_AGE_SECONDS);
    expect(headers).toEqual({
      "Cache-Control":
        "public, max-age=5, s-maxage=5, stale-while-revalidate=20, stale-if-error=300",
      ETag: 'W/"abc-10"',
    });

    const notModified = notModifiedResponse('W/"abc-10"', SCORE_MAX_AGE_SECONDS);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe('W/"abc-10"');
    expect(notModified.headers.get("cache-control")).toContain("max-age=5");
    await expect(notModified.text()).resolves.toBe("");
  });
});
