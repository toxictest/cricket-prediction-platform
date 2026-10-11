import { SignJWT, jwtVerify } from "jose";

/* ==========================================================================
   MEMBER TOKENS — the native-client half of the session
   ==========================================================================

   The web signs a member in with a NextAuth cookie. A phone has no cookie jar
   that NextAuth will accept, so the mobile app exchanges a Google ID token for
   one of these and sends it as `Authorization: Bearer <token>`.

   Two rules keep this from becoming a second, weaker auth system:

   1. The token proves *identity* only. Everything a member is allowed to read
      or move still comes out of PostgreSQL through the same services the web
      uses (`getWallet`, `createPaymentRequest`, …), so a forged-or-stolen token
      cannot name a different user id — the id is read from the signature.
   2. It is signed with its own secret and its own issuer/audience, so a token
      minted here is never valid as an admin session and vice versa.

   There is no server-side revocation list for members today — the web session
   has none either (`User` rows are the authority, and deleting one kills access
   on the next read). See `docs/SYSTEM_DESIGN.md` §15.1: if a "log out all
   devices" button ever matters, that is where the member-session table goes.
   ========================================================================== */

/** Long by design: a phone should not ask for Google sign-in every day. */
export const MEMBER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_ISSUER = "cpc-member";
const TOKEN_AUDIENCE = "cpc-member";
/** Present on every token minted here, so a stray JWT with the right shape is not enough. */
const TOKEN_TYPE = "member-access";

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_PREFIX = "replace-me";

export type MemberTokenErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED";

export class MemberTokenError extends Error {
  constructor(
    public readonly code: MemberTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemberTokenError";
  }
}

/**
 * The signing key. `MEMBER_TOKEN_SECRET` is preferred; `NEXTAUTH_SECRET` is the
 * fallback because it already guards the same identity and requiring a second
 * variable is how a deployment ends up signing mobile tokens with a value
 * copied out of a README.
 *
 * Throws rather than defaulting: a known secret means anyone can mint a member
 * token and read somebody's wallet.
 */
export function getMemberTokenSecret(): Uint8Array {
  const secret = process.env.MEMBER_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret.length < MIN_SECRET_LENGTH || secret.startsWith(PLACEHOLDER_PREFIX)) {
    throw new MemberTokenError(
      "AUTH_NOT_CONFIGURED",
      "Mobile sign-in is not configured on this server.",
    );
  }
  return new TextEncoder().encode(secret);
}

/** False when this server cannot mint tokens at all — used to answer 503, not 500. */
export function memberAuthConfigured(): boolean {
  try {
    getMemberTokenSecret();
    return true;
  } catch {
    return false;
  }
}

export type MintedMemberToken = {
  token: string;
  /** Seconds since the epoch, so a client can decide to re-auth before it expires. */
  expiresAt: number;
  expiresInSeconds: number;
};

/**
 * `email` is inside the payload on purpose. `/api/me` re-reads the row anyway, so
 * the claim is a convenience for a client that wants to render a name offline —
 * it is never the source of truth for anything that moves money.
 */
export async function mintMemberToken(input: {
  userId: string;
  email?: string | null;
}): Promise<MintedMemberToken> {
  const key = getMemberTokenSecret();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MEMBER_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({ typ: TOKEN_TYPE, uid: input.userId, email: input.email ?? null })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);

  return { token, expiresAt: exp, expiresInSeconds: MEMBER_TOKEN_TTL_SECONDS };
}

/**
 * Verified claims, or a `MemberTokenError` saying which step failed. The caller
 * turns that into a 401; it never falls back to "treat it as signed out and
 * carry on", which is how a stale token becomes a silent empty wallet screen.
 */
export async function verifyMemberToken(
  token: string,
): Promise<{ userId: string; email: string | null }> {
  const key = getMemberTokenSecret();

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      clockTolerance: 5,
    }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new MemberTokenError(
      name.includes("Expired") ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      name.includes("Expired") ? "This sign-in has expired." : "This sign-in is not valid.",
    );
  }

  // Signature alone is not enough: the token has to be one *this* function minted.
  if (payload.typ !== TOKEN_TYPE || typeof payload.uid !== "string" || payload.uid.length === 0) {
    throw new MemberTokenError("INVALID_TOKEN", "This sign-in is not valid.");
  }

  return {
    userId: payload.uid,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}
