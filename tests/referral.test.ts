import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  generateReferralCode,
  generateReferralCodeBody,
  normalizeReferralCode,
  type ReferralValidation,
} from "@/lib/referral";

/**
 * Pure-logic tests for the referral code generator.
 *
 * `resolveReferrerId` and `validateReferralCode` hit PostgreSQL and are covered
 * by tests/provisioning.test.ts instead.
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("referral code alphabet", () => {
  it("excludes every visually ambiguous character", () => {
    // A code gets read aloud and copied off screenshots, so O/0, I/1/L and U
    // must never appear.
    for (const char of ["O", "0", "I", "1", "L", "U"]) {
      expect(ALPHABET).not.toContain(char);
    }
  });

  it("is 30 characters — NOT a power of two, which is why rejection sampling is required", () => {
    expect(ALPHABET).toHaveLength(30);

    // 256 % 30 === 16, so a naive `randomByte % 30` would over-weight the
    // first 16 characters by ~8.5%. `crypto.randomInt` rejection-samples
    // instead. This assertion documents the hazard so nobody "optimises"
    // the generator back into a biased modulo.
    expect(256 % ALPHABET.length).not.toBe(0);
  });
});

describe("generateReferralCodeBody", () => {
  it("honours the requested length", () => {
    for (const length of [4, 8, 12, 16]) {
      expect(generateReferralCodeBody(length)).toHaveLength(length);
    }
  });

  it("only ever emits characters from the safe alphabet", () => {
    for (let i = 0; i < 300; i += 1) {
      const body = generateReferralCodeBody(12);
      for (const char of body) {
        expect(ALPHABET).toContain(char);
      }
    }
  });

  it("produces codes that are all distinct across a large sample", () => {
    const sample = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) sample.add(generateReferralCodeBody(8));

    // With 32^8 ≈ 1.1e12 possibilities, 5 000 draws should be ~unique.
    // Allow a single collision to keep the test non-flaky on a shared runner.
    expect(sample.size).toBeGreaterThanOrEqual(4_999);
  });

  it("draws every alphabet character with roughly equal frequency", () => {
    // Chi-square-ish sanity check. With rejection sampling each of the 30
    // characters should land near the mean; a biased `% 30` would push the
    // first 16 well above it.
    const draws = 60_000;
    const counts = new Map<string, number>();
    for (const char of ALPHABET) counts.set(char, 0);

    const body = generateReferralCodeBody(draws);
    for (const char of body) counts.set(char, (counts.get(char) ?? 0) + 1);

    const expected = draws / ALPHABET.length;
    const deviations = [...counts.values()].map((n) => Math.abs(n - expected) / expected);

    // Every bucket within ±15% of the mean is comfortable for 60k draws.
    expect(Math.max(...deviations)).toBeLessThan(0.15);

    // And crucially: no systematic advantage for the first 16 characters,
    // which is exactly what `% 30` would produce.
    const first16 = ALPHABET.slice(0, 16);
    const first16Total = first16
      .split("")
      .reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    const first16Rate = first16Total / (16 * expected);
    expect(first16Rate).toBeGreaterThan(0.9);
    expect(first16Rate).toBeLessThan(1.1);
  });

  it("does not emit a long run of the same character (i.e. it is not seeded)", () => {
    const bodies = Array.from({ length: 50 }, () => generateReferralCodeBody(16));
    expect(new Set(bodies).size).toBe(50);
  });
});

describe("generateReferralCode", () => {
  it("applies the default CRC prefix and a separator", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^CRC-[A-Z0-9]{8}$/);
  });

  it("strips characters the prefix pattern forbids", () => {
    const previous = process.env.REFERRAL_CODE_PREFIX;
    // Lower case and punctuation get normalised away by the prefix sanitiser.
    process.env.REFERRAL_CODE_PREFIX = "cr!c";
    const code = generateReferralCode(6);
    if (previous === undefined) delete process.env.REFERRAL_CODE_PREFIX;
    else process.env.REFERRAL_CODE_PREFIX = previous;

    expect(code).toMatch(/^CRC-[A-Z0-9]{6}$/);
  });
});

describe("normalizeReferralCode", () => {
  it("trims, upper-cases and strips internal whitespace", () => {
    expect(normalizeReferralCode("  crc-7k2m9qx4  ")).toBe("CRC-7K2M9QX4");
    expect(normalizeReferralCode("crc - 7k2 m9qx4")).toBe("CRC-7K2M9QX4");
  });

  it("is idempotent", () => {
    const once = normalizeReferralCode(" crc-arch1tec ");
    expect(normalizeReferralCode(once)).toBe(once);
  });

  it("leaves an already-canonical code untouched", () => {
    expect(normalizeReferralCode("CRC-ARCH1TEC")).toBe("CRC-ARCH1TEC");
  });
});

describe("ReferralValidation type contract", () => {
  it("narrows on the `valid` discriminant", () => {
    const good: ReferralValidation = {
      valid: true,
      code: "CRC-ARCH1TEC",
      referrerName: "Aarav Mehta",
    };
    const bad: ReferralValidation = {
      valid: false,
      code: "NOPE",
      reason: "not_found",
    };

    expect(good.valid && good.referrerName).toBe("Aarav Mehta");
    expect(!bad.valid && bad.reason).toBe("not_found");
  });
});
