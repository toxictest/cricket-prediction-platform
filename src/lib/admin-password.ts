import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

/**
 * Password hashing for back-office accounts.
 *
 * bcrypt through bcryptjs, which is pure JavaScript, so there is no native
 * build step on Vercel. bcrypt reads only the first 72 bytes of its input and
 * silently ignores the rest, so password-setting paths reject anything longer
 * instead of truncating it.
 */

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_BYTES = 72;

/** bcrypt work factor. Each increment doubles the cost. */
const BCRYPT_ROUNDS = 12;

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Policy for passwords being set (bootstrap, and any future admin management).
 * Login does not re-check it, so existing accounts are never locked out by a policy change.
 */
export function checkAdminPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters long.`,
    };
  }
  if (Buffer.byteLength(password, "utf8") > ADMIN_PASSWORD_MAX_BYTES) {
    return {
      ok: false,
      reason: `Password must be at most ${ADMIN_PASSWORD_MAX_BYTES} bytes long.`,
    };
  }
  return { ok: true };
}

export function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Resolves `false` for a wrong password or a malformed stored hash. Never
 * throws, so the caller can treat both cases the same way.
 */
export async function verifyAdminPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

/*
 * Login compares the submitted password against this hash when the email is
 * unknown. The comparison then costs the same time as a real one, so response
 * timing cannot reveal which emails are registered. The hash is computed when
 * the module loads, so the first request does not pay for it. The plaintext is
 * random and discarded, so nobody can know it.
 */
const UNKNOWN_USER_HASH = hashAdminPassword(randomBytes(32).toString("hex"));

export function getUnknownUserHash(): Promise<string> {
  return UNKNOWN_USER_HASH;
}
