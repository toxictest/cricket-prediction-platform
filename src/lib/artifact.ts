import { createHash } from "crypto";
import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import path from "path";

/* ==========================================================================
   ARTIFACT RESOLUTION
   --------------------------------------------------------------------------
   Everything the Download Center displays about the build is derived from the
   real file on disk plus an optional `release.json` manifest. Nothing about a
   release is hard-coded in the source tree.
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

/**
 * Optional sidecar describing the build. Only *descriptive* fields are read
 * from here — never the checksum, size or dates, which are all measured from
 * the file itself so they cannot drift out of sync with the bytes shipped.
 *
 * Placed next to the APK so a release is two files: the binary and its label.
 */
const MANIFEST_PATH = path.join(process.cwd(), "storage", "apk", "release.json");

/** Shape of `storage/apk/release.json`. Every field is optional. */
export type ReleaseManifest = {
  packageName?: string;
  buildNumber?: string;
  versionName?: string;
  minAndroid?: string;
  architecture?: string;
  /** ISO date. Overrides the file's mtime for display. */
  releasedAt?: string;
  notes?: string;
};

export type ArtifactInfo = {
  fileName: string;
  filePath: string;
  /** Exact byte length, measured from disk. */
  sizeBytes: number;
  /** Human label derived from `sizeBytes`, e.g. "18.4 MB". */
  sizeLabel: string;
  /** Lower-case hex SHA-256 of the artifact on disk. */
  checksum: string;
  /** ISO date the build was released — file mtime, or the manifest override. */
  releasedAt: string;
  /**
   * True when the file is implausibly small for a real Android package
   * (< 64 KB). A genuine release APK is megabytes. This is a guard against
   * accidentally shipping a stub, not a description of the current file.
   */
  isStub: boolean;
  /** Descriptive metadata, from `release.json` when present. */
  packageName: string | null;
  buildNumber: string | null;
  versionName: string | null;
  minAndroid: string | null;
  architecture: string | null;
  notes: string | null;
  /** True when the metadata above came from a real manifest. */
  hasManifest: boolean;
  /** True when an external CDN URL is configured instead. */
  isExternal: boolean;
  /** Set only when `NEXT_PUBLIC_APK_DOWNLOAD_URL` points somewhere else. */
  externalUrl: string | null;
};

/** Checksums are expensive (tens of MB to hash); cache per process. */
let cached: ArtifactInfo | null = null;
let cacheKey: string | null = null;

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

/** Reads `release.json`. A malformed manifest is ignored, never fatal. */
async function readManifest(): Promise<ReleaseManifest | null> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn("[artifact] release.json is not an object — ignoring");
      return null;
    }
    return parsed as ReleaseManifest;
  } catch {
    // Absent in most checkouts. That is a valid state, not an error.
    return null;
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Locates the distributable and derives everything about it from the real file.
 *
 * Deriving the checksum and size from the bytes on disk means the values shown
 * in the Download Center are always the values of the file the member actually
 * receives. Drop in a new build and the page updates itself — there is no
 * constant to forget.
 *
 * Returns `null` when nothing is staged. Callers must render an explicit
 * "not available" state; they must never invent a version, size or hash.
 */
export async function resolveArtifact(): Promise<ArtifactInfo | null> {
  const externalUrl = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL?.trim() || null;

  // Only the local files affect the cache key; the CDN URL is applied on read.
  if (cached && cacheKey !== externalUrl) {
    return { ...cached, externalUrl };
  }

  for (const candidate of SEARCH_PATHS) {
    try {
      const info = await stat(candidate);
      if (!info.isFile() || info.size === 0) continue;

      const [checksum, manifest] = await Promise.all([
        sha256File(candidate),
        readManifest(),
      ]);

      cached = {
        fileName: path.basename(candidate),
        filePath: candidate,
        sizeBytes: info.size,
        sizeLabel: humanSize(info.size),
        checksum,
        releasedAt: clean(manifest?.releasedAt) ?? info.mtime.toISOString(),
        isStub: info.size < 64 * 1024,
        packageName: clean(manifest?.packageName),
        buildNumber: clean(manifest?.buildNumber),
        versionName: clean(manifest?.versionName),
        minAndroid: clean(manifest?.minAndroid),
        architecture: clean(manifest?.architecture),
        notes: clean(manifest?.notes),
        hasManifest: manifest !== null,
        isExternal: false,
        externalUrl,
      };
      cacheKey = externalUrl;

      return cached;
    } catch {
      // ENOENT on this path — try the next one.
    }
  }

  // No local bytes. If a CDN URL is configured we can still describe the
  // release, but size and checksum are genuinely unknown and must say so.
  if (externalUrl) {
    const manifest = await readManifest();
    cached = {
      fileName: APK_FILE_NAME,
      filePath: externalUrl,
      sizeBytes: 0,
      sizeLabel: "not measured",
      checksum: "not measured",
      releasedAt: clean(manifest?.releasedAt) ?? "",
      isStub: false,
      packageName: clean(manifest?.packageName),
      buildNumber: clean(manifest?.buildNumber),
      versionName: clean(manifest?.versionName),
      minAndroid: clean(manifest?.minAndroid),
      architecture: clean(manifest?.architecture),
      notes: clean(manifest?.notes),
      hasManifest: manifest !== null,
      isExternal: true,
      externalUrl,
    };
    cacheKey = externalUrl;
    return cached;
  }

  cached = null;
  cacheKey = null;
  return null;
}

/** Clears the memoised lookup — call after replacing the APK in dev. */
export function invalidateArtifactCache(): void {
  cached = null;
  cacheKey = null;
}

/** Absolute path the manifest is expected at, for error messages. */
export const RELEASE_MANIFEST_PATH = MANIFEST_PATH;
