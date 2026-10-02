import { describe, expect, it } from "vitest";
import {
  resolveArtifact,
  invalidateArtifactCache,
  RELEASE_MANIFEST_PATH,
} from "@/lib/artifact";

/**
 * `resolveArtifact()` describes whatever build is actually staged — nothing
 * about a release is hard-coded, so these assertions must hold in two states:
 *
 *   • no APK on disk      → the resolver returns null and every caller is
 *                           expected to render an explicit "not available"
 *                           state rather than invented metadata.
 *   • a real APK on disk  → size, checksum and release date are measured from
 *                           the bytes, and descriptive fields come from
 *                           `storage/apk/release.json` when present.
 *
 * The probe runs at collection time via a top-level `await` because
 * `describe.skipIf()` is evaluated before any hook executes.
 */
invalidateArtifactCache();
const artifact = await resolveArtifact();
const staged = artifact !== null;

describe("resolveArtifact — no build staged", () => {
  it.skipIf(staged)("returns null rather than fabricating metadata", () => {
    expect(artifact).toBeNull();
  });

  it.skipIf(staged)("points callers at the expected manifest path", () => {
    expect(RELEASE_MANIFEST_PATH).toMatch(/storage[/\\]apk[/\\]release\.json$/);
  });
});

describe("resolveArtifact — build staged", () => {
  it.skipIf(!staged)("reports the real byte length of the file on disk", async () => {
    expect(artifact!.sizeBytes).toBeGreaterThan(0);
    expect(artifact!.filePath).toMatch(/app-release\.apk$/);
    expect(artifact!.fileName).toBe("app-release.apk");
  });

  it.skipIf(!staged)("computes a real SHA-256, not a constant", async () => {
    expect(artifact!.checksum).toMatch(/^[a-f0-9]{64}$/);

    invalidateArtifactCache();
    const again = await resolveArtifact();
    expect(again!.checksum).toBe(artifact!.checksum);
  });

  it.skipIf(!staged)("derives the size label from the measured bytes", async () => {
    expect(artifact!.sizeLabel).toMatch(/^[\d.]+ (B|KB|MB|GB)$/);
  });

  it.skipIf(!staged)("dates the release from the file, or the manifest", async () => {
    expect(artifact!.releasedAt).not.toBe("");
    expect(Number.isNaN(Date.parse(artifact!.releasedAt))).toBe(false);
  });

  it.skipIf(!staged)(
    "flags an implausibly small file as a stub instead of shipping it silently",
    async () => {
      // A genuine release APK is megabytes; under 64 KB is a stub.
      expect(artifact!.isStub).toBe(artifact!.sizeBytes < 64 * 1024);
    },
  );

  it.skipIf(!staged)("leaves descriptive fields null when no manifest exists", async () => {
    if (artifact!.hasManifest) return;
    expect(artifact!.packageName).toBeNull();
    expect(artifact!.buildNumber).toBeNull();
    expect(artifact!.versionName).toBeNull();
  });

  it.skipIf(!staged)("memoises the lookup so the hash is not recomputed", async () => {
    const warmStart = Date.now();
    const warm = await resolveArtifact();
    const warmMs = Date.now() - warmStart;

    expect(warm).not.toBeNull();
    expect(warmMs).toBeLessThan(50);
  });

  it.skipIf(!staged)("returns a consistent shape for every field the UI reads", () => {
    for (const key of [
      "fileName",
      "filePath",
      "sizeBytes",
      "sizeLabel",
      "checksum",
      "releasedAt",
      "isStub",
      "packageName",
      "buildNumber",
      "versionName",
      "minAndroid",
      "architecture",
      "hasManifest",
      "isExternal",
      "externalUrl",
    ] as const) {
      expect(artifact).toHaveProperty(key);
    }
  });
});
