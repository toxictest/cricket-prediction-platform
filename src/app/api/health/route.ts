import { guardRoute, apiSuccess, errorResponse, redactSecrets } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + readiness probe.
 *
 *   GET /api/health
 *
 * Returns 200 when the process is up and PostgreSQL answers a trivial query,
 * 503 otherwise. Safe to poll from a container orchestrator or uptime monitor —
 * it never leaks connection strings or row data.
 */
async function handleGET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return apiSuccess(
      {
        status: "healthy",
        database: "connected",
        latencyMs: Date.now() - startedAt,
        runtime: "nodejs",
        version: process.env.APK_VERSION ?? "1.0.0",
        timestamp: new Date().toISOString(),
      },
      200,
      { "Cache-Control": "no-store, max-age=0" },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[health] database check failed:", redactSecrets(detail));

    // `redactSecrets` is not paranoia for show: Prisma's connect failure puts the
    // full DATABASE_URL — username and password included — into its message, and
    // this endpoint is reachable by anybody who can reach the app.
    return errorResponse("INTERNAL_ERROR", 503, "Database unreachable", {
      details: process.env.NODE_ENV === "development" ? { detail: redactSecrets(detail) } : undefined,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/health", handleGET);
