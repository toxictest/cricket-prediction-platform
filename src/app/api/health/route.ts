import { NextResponse } from "next/server";
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
export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        ok: true,
        data: {
          status: "healthy",
          database: "connected",
          latencyMs: Date.now() - startedAt,
          runtime: "nodejs",
          version: process.env.APK_VERSION ?? "1.0.0",
          timestamp: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch (error) {
    console.error("[health] database check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Database unreachable",
        code: "INTERNAL_ERROR",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
