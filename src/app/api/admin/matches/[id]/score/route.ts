import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { upsertLiveScore } from "@/lib/match";
import { matchErrorResponse, parseScoreBody, toMatchActor } from "@/lib/match-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_ROLES: Role[] = ["SUPER_ADMIN", "SCORE_ADMIN"];

/**
 * POST /api/admin/matches/:id/score
 * Body: { teamAScore, teamBScore, currentOver, batsmanStats?, bowlerStats?, expectedVersion? }
 *
 * Creates or replaces the match's one scoreboard and records who wrote it. A
 * score may be sent as "182/4" or as a bare number of runs, in which case the
 * wickets carry over from the row being replaced; overs are "16.3", and the balls
 * digit is refused above 5 because a sixth ball ends the over.
 *
 * Two writers, one scoreboard: the match row is locked for the duration, so two
 * posts cannot interleave, and `version` increments on every accepted write. Send
 * `expectedVersion` and a lost race costs you a 409 with the current version
 * instead of quietly replacing someone else's over.
 *
 * A score that moves the game backwards is refused with 409 SCORE_REVERSAL,
 * because the ordinary cause is a stale tab, not a corrected score. A Super Admin
 * may post anything, so a genuine correction is never blocked — and a COMPLETED
 * match's result is closed to everyone else.
 *
 *   201 the scoreboard did not exist and now does
 *   200 { created, match, score, warnings } on every later write
 *   400 a field is unusable
 *   404 no such match
 *   409 SCORE_STALE, SCORE_REVERSAL or MATCH_LOCKED
 *   415 body is not application/json
 */
async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(MATCH_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseScoreBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await upsertLiveScore(id, payload.data, toMatchActor(guard.admin));
    // 201 only for the first post: after that this is a replacement of the one
    // scoreboard the match has, and `created` in the body says which it was.
    return adminJson({ ok: true, data: result }, result.created ? 201 : 200);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/matches/[id]/score", handlePOST);
