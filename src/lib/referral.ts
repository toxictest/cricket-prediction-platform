import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Crockford-style alphabet: the digits `0`/`1` and the letters `I`/`L`/`O`/`U`
 * are removed.
 *
 * Removing visually ambiguous glyphs means a code can be read aloud over a
 * voice call or copied off a screenshot without transcription errors.
 *
 * NOTE: this is a **30-character** alphabet, not a power of two. That matters
 * for how the codes are drawn — see `generateReferralCodeBody`.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const DEFAULT_LENGTH = 8;
const DEFAULT_PREFIX = "CRC";
const MAX_ATTEMPTS = 12;

function codeLength(): number {
  const parsed = Number.parseInt(process.env.REFERRAL_CODE_LENGTH ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 4 && parsed <= 16
    ? parsed
    : DEFAULT_LENGTH;
}

function codePrefix(): string {
  return (process.env.REFERRAL_CODE_PREFIX ?? DEFAULT_PREFIX)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

/**
 * Cryptographically-random body of the referral code.
 *
 * Uses `crypto.randomInt`, which performs **rejection sampling** internally —
 * it discards out-of-range draws instead of folding them with `%`, so every
 * character is exactly equiprobable.
 *
 * Why that matters here: the alphabet is 30 characters, and 256 is not a
 * multiple of 30 (`256 % 30 === 16`). A naive `randomBytes()[i] % 30` would make
 * the first 16 characters of the alphabet ~8.5% more likely than the rest,
 * measurably shrinking the effective keyspace. `randomInt` avoids that
 * entirely, and wrapping it in a loop keeps the call cryptographically secure
 * without needing a power-of-two alphabet.
 */
export function generateReferralCodeBody(length = codeLength()): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Full, user-facing referral code, e.g. "CRC-7K2M9QX4". */
export function generateReferralCode(length = codeLength()): string {
  const prefix = codePrefix();
  const body = generateReferralCodeBody(length);
  return prefix ? `${prefix}-${body}` : body;
}

/**
 * Generates a referral code that is guaranteed unique in the database.
 *
 * Strategy: optimistic insert-and-retry. We pre-check with a `findUnique`,
 * but because two concurrent sign-ups could both pass that check, the
 * authoritative guarantee is the `@unique` constraint on `User.referralCode`
 * combined with the caller retrying on a P2002 collision.
 */
export async function generateUniqueReferralCode(
  length = codeLength(),
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateReferralCode(length);
    const existing = await prisma.user.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  // Astronomically unlikely: fall back to a longer code rather than failing
  // the user's registration.
  return generateReferralCode(length + 4);
}

/** Normalise user input before lookup: trim, uppercase, re-insert separator. */
export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Resolves a referral code to the owning user id.
 * Returns `null` for blank input, unknown codes, or self-referral.
 */
export async function resolveReferrerId(
  rawCode: string | null | undefined,
  selfEmail?: string,
): Promise<string | null> {
  if (!rawCode) return null;

  const code = normalizeReferralCode(rawCode);
  if (code.length < 4) return null;

  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, email: true },
  });

  if (!referrer) return null;
  if (selfEmail && referrer.email.toLowerCase() === selfEmail.toLowerCase()) {
    return null; // a member must not be able to refer themselves
  }
  return referrer.id;
}

/** Human-readable referral code validation result, used by /api/referral. */
export type ReferralValidation =
  | { valid: true; code: string; referrerName: string }
  | { valid: false; code: string; reason: "not_found" | "malformed" };

export async function validateReferralCode(
  rawCode: string,
): Promise<ReferralValidation> {
  const code = normalizeReferralCode(rawCode);

  if (code.length < 4 || code.length > 24 || !/^[A-Z0-9-]+$/.test(code)) {
    return { valid: false, code, reason: "malformed" };
  }

  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { name: true },
  });

  if (!referrer) return { valid: false, code, reason: "not_found" };
  return { valid: true, code, referrerName: referrer.name };
}
