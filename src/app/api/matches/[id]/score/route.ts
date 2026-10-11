import type { NextRequest } from "next/server";
import { guardRoute, apiJson } from "@/lib/http";
import { SCORE_MAX_AGE_SECONDS, getLiveScore } from "@/lib/match";
import {
  buildEtag,
  isNotModified,
  matchErrorResponse,
  notModifiedResponse,
  publicCacheHeaders,
} from "@/lib/match-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/matches/:id/score
 *
 * The scoreboard, public, cached for a few seconds and carrying an ETag built
 * from `version`. No sign-in. A client that polls every 10 s spends almost nothing while the
 * score is unchanged, and `version` in the tag is what makes that safe: two
 * different states of one match cannot produce the same tag.
 *
 *   200 { match, score }   — `score` is null before the first update
 *
 * `lastUpdatedBy` is not on this response: which staff account wrote a board is
 * back-office identity and only `GET /api/admin/matches` shows it.
 *   304 not modified
 *   400 malformed id
 *   404 no such match
 *
 * The read happens before the 304 decision, so a poll still costs one indexed
 * query. That is the trade this endpoint makes on purpose: the expensive part of
 * a scoreboard poll is the response body, and that is what the ETag removes.
 * If the match is later wired to a score provider, push (or SSE) replaces the
 * polling; the shape here would not change.
 */
async function handleGET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const result = await getLiveScore(id);
    const etag = buildEtag({
      version: result.score?.version ?? null,
      updatedAt: result.score?.updatedAt ?? null,
      status: result.match.status,
    });

    if (isNotModified(request.headers.get("if-none-match"), etag)) {
      return notModifiedResponse(etag, SCORE_MAX_AGE_SECONDS);
    }

    return apiJson({ ok: true, data: result }, 200, publicCacheHeaders(etag, SCORE_MAX_AGE_SECONDS));
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/matches/[id]/score", handleGET);
