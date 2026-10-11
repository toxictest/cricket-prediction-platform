import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { createMatch, listMatchesForAdmin } from "@/lib/match";
import {
  matchErrorResponse,
  parseCreateMatchBody,
  parseMatchQuery,
  toMatchActor,
} from "@/lib/match-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who runs the fixture calendar. SUPER_ADMIN is not an implicit pass, so it is listed. */
const MATCH_ROLES: Role[] = ["SUPER_ADMIN", "SCORE_ADMIN"];

/**
 * GET /api/admin/matches?status=LIVE&from=&to=&order=&limit=&cursor=&q=
 *
 * The console's list: every field a public reader gets, plus `qrCodeUrl`,
 * `externalId`, who last touched the scoreboard, and `counts` for the status tabs
 * of the whole filtered set. `q` searches title and both team names.
 *
 *   200 { items, nextCursor, order, counts }
 *   400 bad query
 *   401 / 403 missing or unusable admin session, or a role that does not manage matches
 */
async function handleGET(request: NextRequest) {
  const guard = await requireAdmin(MATCH_ROLES);
  if (!guard.ok) return guard.response;

  const query = parseMatchQuery(request.nextUrl.searchParams, { allowSearch: true });
  if (!query.ok) return query.response;

  try {
    const page = await listMatchesForAdmin(query.data);
    return adminJson({ ok: true, data: page }, 200);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

/**
 * POST /api/admin/matches
 * Body: { title, teamA, teamB, startTime, qrCodeUrl?, externalId? }
 *
 * Creates a fixture in status UPCOMING. `status` is not accepted on create —
 * moving a match to LIVE is a transition, and transitions are validated where
 * the rest of them are, in PATCH below.
 *
 *   201 the match
 *   400 a field is unusable, the two teams are the same, or the time is not a date
 *   409 another match has the same two teams at the same start time, or already
 *     uses this `externalId`
 *   415 body is not application/json
 *
 * `qrCodeUrl` is the image members are told to pay into for this match. Setting it
 * here is not gated on `MONEY_MODE`, because a fixture has to be prepared while
 * the money features are off; what the flag controls is whether anyone is shown
 * the link. Every attach, replace and clear is logged with the admin id.
 */
async function handlePOST(request: NextRequest) {
  const guard = await requireAdmin(MATCH_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parseCreateMatchBody(body.data);
  if (!payload.ok) return payload.response;

  try {
    const match = await createMatch(payload.data, toMatchActor(guard.admin));
    return adminJson({ ok: true, data: match }, 201);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/admin/matches", handleGET);
export const POST = guardRoute("api/admin/matches", handlePOST);
