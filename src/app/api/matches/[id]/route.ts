import type { NextRequest } from "next/server";
import { guardRoute, apiJson } from "@/lib/http";
import { LIST_MAX_AGE_SECONDS, getPublicMatch } from "@/lib/match";
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
 * GET /api/matches/:id
 *
 * One fixture, the same shape as a row of `GET /api/matches`, so a client needs
 * one renderer. No sign-in.
 *
 *   200 the match and its scoreboard summary
 *   304 the caller's ETag still matches
 *   400 malformed id
 *   404 no such match
 *
 * `qrCodeUrl` is not here. It is a payment destination, and it leaves this
 * application only through `GET /api/payment/qr`, which needs a member session
 * and is closed unless `MONEY_MODE` is on.
 */
async function handleGET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const match = await getPublicMatch(id);
    const etag = buildEtag({
      version: match.score?.version ?? null,
      updatedAt: match.score?.updatedAt ?? match.updatedAt,
      status: match.status,
      extra: match.startTime.toISOString(),
    });

    if (isNotModified(request.headers.get("if-none-match"), etag)) {
      return notModifiedResponse(etag, LIST_MAX_AGE_SECONDS);
    }

    return apiJson({ ok: true, data: match }, 200, publicCacheHeaders(etag, LIST_MAX_AGE_SECONDS));
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/matches/[id]", handleGET);
