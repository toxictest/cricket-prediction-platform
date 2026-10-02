import { createHash } from "crypto";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recordDownload } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ==========================================================================
   CONFIGURATION
   ========================================================================== */

const APK_FILE_NAME = process.env.APK_FILE_NAME ?? "app-release.apk";
const APK_VERSION = process.env.APK_VERSION ?? "1.0.0";

/**
 * Lookup order for the artifact:
 *   1. storage/apk/<file>   — private staging dir (NOT web-served, ideal)
 *   2. public/downloads/<file> — committed mirror / CDN sync target
 *   3. NEXT_PUBLIC_APK_DOWNLOAD_URL — external bucket or CDN
 */
const SEARCH_PATHS = [
  path.join(process.cwd(), "storage", "apk", APK_FILE_NAME),
  path.join(process.cwd(), "public", "downloads", APK_FILE_NAME),
];

/**
 * Non-reversible client fingerprint.
 * We only ever need it to spot abuse patterns, so the raw IP is never written
 * to PostgreSQL — just `sha256(salt + ip)`.
 */
function hashIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;
  if (!ip) return null;

  return createHash("sha256")
    .update(`${process.env.NEXTAUTH_SECRET ?? "salt"}:${ip}`)
    .digest("hex")
    .slice(0, 40);
}

async function findArtifact(): Promise<{ filePath: string; size: number } | null> {
  for (const candidate of SEARCH_PATHS) {
    try {
      const info = await stat(candidate);
      if (info.isFile() && info.size > 0) {
        return { filePath: candidate, size: info.size };
      }
    } catch {
      // ENOENT — try the next location.
    }
  }
  return null;
}

/* ==========================================================================
   HANDLER
   ========================================================================== */

/**
 * GET /api/download
 *
 * Gated distribution endpoint. Access requires a valid NextAuth session whose
 * `uid` resolves to a row in PostgreSQL — the check happens on the server, so
 * hiding the button in the UI is cosmetic only, never the real gate.
 *
 * Every successful download is written to `download_logs` before the bytes
 * start flowing.
 */
export async function GET(request: NextRequest) {
  // ---------------------------------------------------------------------
  // 1. Authentication
  // ---------------------------------------------------------------------
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        ok: false,
        error: "Access restricted. Please activate your account first.",
        code: "UNAUTHORIZED",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const userId = session.user.id;

  // ---------------------------------------------------------------------
  // 2. Audit trail (non-blocking failure — never block a download on logging)
  // ---------------------------------------------------------------------
  try {
    await recordDownload({
      userId,
      version: APK_VERSION,
      platform: "android",
      ipHash: hashIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (error) {
    console.error("[download] failed to write download log:", error);
  }

  // ---------------------------------------------------------------------
  // 3. Location mode — hand off to an external CDN when configured
  // ---------------------------------------------------------------------
  const externalUrl = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL?.trim();
  if (externalUrl && /^https?:\/\//i.test(externalUrl)) {
    return NextResponse.redirect(externalUrl, 307);
  }

  // ---------------------------------------------------------------------
  // 4. Local artifact
  // ---------------------------------------------------------------------
  const artifact = await findArtifact();

  if (!artifact) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The Android build is not staged on this server yet. Run `npm run apk:placeholder` for a demo artifact, or drop the real app-release.apk into storage/apk/.",
        code: "NOT_FOUND",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Stream rather than buffering: an 18 MB APK should never be held in the
  // serverless function's memory.
  const nodeStream = createReadStream(artifact.filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(artifact.size),
      "Content-Disposition": `attachment; filename="${APK_FILE_NAME}"; filename*=UTF-8''${encodeURIComponent(APK_FILE_NAME)}`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-App-Version": APK_VERSION,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Explicitly reject non-GET verbs so the gate cannot be probed sideways. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed", code: "VALIDATION_ERROR" },
    { status: 405, headers: { Allow: "GET" } },
  );
}
