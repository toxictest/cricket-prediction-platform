import type { NextRequest } from "next/server";
import { guardRoute, apiJson } from "@/lib/http";
import { LIST_MAX_AGE_SECONDS, listPublicMatches } from "@/lib/match";
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
 * GET /api/matches?status=LIVE&from=2026-10-01&to=2026-10-31&order=asc&limit=20&cursor=...
 *
 * Every fixture: upcoming, live and completed, with the scoreboard attached so a
 * list is one query rather than N. No sign-in.
 *
 *   200 { items, nextCursor, order }
 *   400 bad status, date, limit, cursor — or `?q=`, which is admin-only
 *
 * Paging walks `(startTime, id)`, so `order` is echoed back: a cursor taken from
 * a `desc` page must not be fed to an `asc` page and start skipping rows.
 *
 * Cacheable for a few seconds, and it carries an ETag, which is what a "matches"
 * screen on a phone needs: the list changes when a match starts or ends, not when
 * someone loads the page. `?q=` is deliberately absent here — a free-text `LIKE`
 * on an unindexed column is not something to hand to anonymous traffic.
 */
async function handleGET(request: NextRequest) {
  const query = parseMatchQuery(request.nextUrl.searchParams, { allowSearch: false });
  if (!query.ok) return query.response;

  try {
    const page = await listPublicMatches(query.data);
    const etag = etagForMatchPage(page.items);

    if (isNotModified(request.headers.get("if-none-match"), etag)) {
      return notModifiedResponse(etag, LIST_MAX_AGE_SECONDS);
    }

    return apiJson({ ok: true, data: page }, 200, publicCacheHeaders(etag, LIST_MAX_AGE_SECONDS));
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/matches", handleGET);
