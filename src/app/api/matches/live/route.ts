import type { NextRequest } from "next/server";
import { guardRoute, apiJson } from "@/lib/http";
import { SCORE_MAX_AGE_SECONDS, listLiveMatches } from "@/lib/match";
import {
  etagForMatchPage,
  isNotModified,
  matchErrorResponse,
  notModifiedResponse,
  parseMatchQuery,
  publicCacheHeaders,
} from "@/lib/match-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/matches/live?limit=50
 *
 * What is being played right now, with the scoreboard inline, most recently
 * scored first. No sign-in. This is the one endpoint a member's screen is expected to poll
 * during a match, so it is shaped for that: no pagination (a page of matches is
 * not a queue to walk), a short shared cache, and an ETag so a poll that
 * changed nothing costs 304 bytes instead of a body.
 *
 *   200 { items, generatedAt }
 *   400 bad limit
 *
 * `generatedAt` is the server's clock at read time. A client that shows "updated
 * 12s ago" should use that, not its own clock, because the two differ by whatever
 * the member's device is off by.
 */
async function handleGET(request: NextRequest) {
  // Same parser as the other lists, so `?limit=` behaves identically everywhere.
  const query = parseMatchQuery(request.nextUrl.searchParams, { allowSearch: false });
  if (!query.ok) return query.response;

  try {
    const result = await listLiveMatches(query.data.limit);

    const etag = etagForMatchPage(result.items);
    if (isNotModified(request.headers.get("if-none-match"), etag)) {
      return notModifiedResponse(etag, SCORE_MAX_AGE_SECONDS);
    }

    return apiJson(
      { ok: true, data: result },
      200,
      publicCacheHeaders(etag, SCORE_MAX_AGE_SECONDS),
    );
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/matches/live", handleGET);
