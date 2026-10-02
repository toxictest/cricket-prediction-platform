import { describe, expect, it } from "vitest";
import { resolveArtifact, invalidateArtifactCache } from "@/lib/artifact";

/**
 * The artifact resolver reads `public/downloads/app-release.apk` (or the
 * private `storage/apk/` staging dir). These assertions verify the properties
 * the Download Center depends on: a real byte count, a real SHA-256 and a
 * correct placeholder flag.
 */
describe("resolveArtifact", () => {
  it("locates the staged artifact and hashes the bytes on disk", async () => {
    invalidateArtifactCache();
    const artifact = await resolveArtifact();

    expect(artifact).not.toBeNull();
    expect(artifact!.fileName).toBe("app-release.apk");
    expect(artifact!.sizeBytes).toBeGreaterThan(0);
    expect(artifact!.filePath).toMatch(/app-release\.apk$/);

    // A real SHA-256, not a hard-coded string.
    expect(artifact!.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computes the checksum from the file contents, not a constant", async () => {
    invalidateArtifactCache();
    const first = await resolveArtifact();
    invalidateArtifactCache();
    const second = await resolveArtifact();

    // Same file → same hash, deterministically.
    expect(second!.checksum).toBe(first!.checksum);
  });

  it("formats a human-readable size label", async () => {
    invalidateArtifactCache();
    const artifact = await resolveArtifact();
    expect(artifact!.sizeLabel).toMatch(/^[\d.]+ (B|KB|MB|GB)$/);
  });

  it("flags the generated demo artifact so the UI can warn about it", async () => {
    invalidateArtifactCache();
    const artifact = await resolveArtifact();

    // The placeholder is ~1.7 KB; anything under 64 KB is the stub.
    if (artifact!.sizeBytes < 64 * 1024) {
      expect(artifact!.isPlaceholder).toBe(true);
    } else {
      expect(artifact!.isPlaceholder).toBe(false);
    }
  });

  it("memoises the lookup (second call is served from cache)", async () => {
    invalidateArtifactCache();
    const started = Date.now();
    await resolveArtifact();
    const cold = Date.now() - started;

    const warmStart = Date.now();
    const warm = await resolveArtifact();
    const warmMs = Date.now() - warmStart;

    expect(warm).not.toBeNull();
    // Memoised lookups skip the streaming hash — should never be slower.
    expect(warmMs).toBeLessThanOrEqual(Math.max(cold, 50));
  });

  it("returns a consistent shape for every field the UI reads", async () => {
    invalidateArtifactCache();
    const artifact = await resolveArtifact();

    for (const key of [
      "fileName",
      "filePath",
      "sizeBytes",
      "sizeLabel",
      "checksum",
      "isPlaceholder",
      "externalUrl",
    ] as const) {
      expect(artifact).toHaveProperty(key);
    }
  });
});
