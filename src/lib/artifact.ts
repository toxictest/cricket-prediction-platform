import { createHash } from "crypto";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";

/* ==========================================================================
   ARTIFACT RESOLUTION
   ========================================================================== */

const APK_FILE_NAME = process.env.APK_FILE_NAME ?? "app-release.apk";

/**
 * Lookup order for the released build:
 *   1. storage/apk/<file>       — private staging dir, never web-served
 *   2. public/downloads/<file>  — committed mirror
 */
const SEARCH_PATHS = [
  path.join(process.cwd(), "storage", "apk", APK_FILE_NAME),
  path.join(process.cwd(), "public", "downloads", APK_FILE_NAME),
];

export type ArtifactInfo = {
  fileName: string;
  filePath: string;
  /** Exact byte length. */
  sizeBytes: number;
  /** Human label, e.g. "18.4 MB" — or "2.1 KB" for the demo placeholder. */
  sizeLabel: string;
  /** Lower-case hex SHA-256 of the artifact on disk. */
  checksum: string;
  /** False when the file looks like the generated demo placeholder. */
  isPlaceholder: boolean;
  /** True when an external CDN URL is configured instead. */
  externalUrl: string | null;
};

/** Checksums are expensive (18 MB hash); cache per process. */
let cached: Omit<ArtifactInfo, "externalUrl"> | null = null;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Locates the distributable and computes its real SHA-256.
 *
 * Deriving the checksum from the bytes on disk (rather than hard-coding it in
 * `lib/constants.ts`) means the hash displayed in the Download Center is always
 * the hash of the file the user actually receives. Drop in a new build and the
 * page updates itself.
 *
 * Returns `null` when nothing is staged; callers fall back to static metadata.
 */
export async function resolveArtifact(): Promise<ArtifactInfo | null> {
  const externalUrl = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL?.trim() || null;

  if (cached) {
    return { ...cached, externalUrl };
  }

  for (const candidate of SEARCH_PATHS) {
    try {
      const info = await stat(candidate);
      if (!info.isFile() || info.size === 0) continue;

      const checksum = await sha256File(candidate);

      // The generated demo archive is ~1.7 KB; a real release is megabytes.
      const isPlaceholder = info.size < 64 * 1024;

      cached = {
        fileName: path.basename(candidate),
        filePath: candidate,
        sizeBytes: info.size,
        sizeLabel: humanSize(info.size),
        checksum,
        isPlaceholder,
      };

      return { ...cached, externalUrl };
    } catch {
      // ENOENT on this path — try the next one.
    }
  }

  return externalUrl ? { ...externalFallback(externalUrl), externalUrl } : null;
}

/** Metadata used when only a CDN URL is configured (no local bytes to hash). */
function externalFallback(externalUrl: string): Omit<ArtifactInfo, "externalUrl"> {
  return {
    fileName: APK_FILE_NAME,
    filePath: externalUrl,
    sizeBytes: 0,
    sizeLabel: "—",
    checksum: "unavailable (remote artifact)",
    isPlaceholder: false,
  };
}

/** Clears the memoised lookup — call after replacing the APK in dev. */
export function invalidateArtifactCache(): void {
  cached = null;
}
