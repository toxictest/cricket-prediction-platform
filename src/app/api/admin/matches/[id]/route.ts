import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute, readJsonBody } from "@/lib/http";
import { updateMatch } from "@/lib/match";
import { matchErrorResponse, parsePatchMatchBody, toMatchActor } from "@/lib/match-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_ROLES: Role[] = ["SUPER_ADMIN", "SCORE_ADMIN"];

/**
 * PATCH /api/admin/matches/:id
 * Body: any of { title, teamA, teamB, startTime, status, qrCodeUrl, externalId }
 *
 * One endpoint for the whole edit form. `qrCodeUrl: null` clears the QR, which is
 * how a payment link is retired without deleting the fixture. Sending a field
 * with the value it already has is not an edit: the response lists what actually
 * changed, and an unchanged save leaves `updatedAt` — and therefore every cached
 * copy of this match — alone.
 *
 * Status moves forward (UPCOMING → LIVE → COMPLETED) for a score admin. Anything
 * else about a match that has been played, and any move backwards, needs
 * SUPER_ADMIN, because predictions and settlement read `status` and `startTime`
 * as facts about the past.
 *
 *   200 { ...match, changed: ["status"] }
 *   400 nothing to change, or a field is unusable
 *   404 no such match
 *   409 MATCH_LOCKED (needs SUPER_ADMIN) or DUPLICATE_MATCH
 *   415 body is not application/json
 */
async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(MATCH_ROLES);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = parsePatchMatchBody(body.data);
  if (!payload.ok) return payload.response;

  const { id } = await context.params;

  try {
    const result = await updateMatch(id, payload.data, toMatchActor(guard.admin));
    return adminJson({ ok: true, data: result }, 200);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const PATCH = guardRoute("api/admin/matches/[id]", handlePATCH);
