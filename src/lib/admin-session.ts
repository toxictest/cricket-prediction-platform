import { createHmac, randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

/**
 * Admin sessions.
 *
 * Login issues a signed JWT (HS256, using jose, the same library NextAuth
 * uses) and stores a matching row in `admin_sessions`. The JWT only says which
 * session it belongs to. The row decides whether that session is still valid,
 * so logout and expiry take effect immediately.
 *
 * The signing secret is ADMIN_SESSION_SECRET, separate from NEXTAUTH_SECRET.
 * A leak of one does not compromise the other, and Google members are unaffected.
 */

/** Absolute lifetime. Sessions do not slide, so the admin signs in again after this. */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

const TOKEN_ISSUER = "cpc-admin";
const TOKEN_AUDIENCE = "cpc-admin";
const MIN_SECRET_LENGTH = 32;
/** Prefix of the placeholder in .env.example. Refusing it stops a copied example file from going live. */
const PLACEHOLDER_PREFIX = "replace-me";

/**
 * Returns the signing key. Throws when the secret is missing, too short, or
 * still the example placeholder. Failing loudly is intentional: a default
 * fallback would let anyone who has read the repository forge admin tokens.
 */
export function getAdminSessionSecret(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH || secret.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error(
      `ADMIN_SESSION_SECRET must be set to a random value of at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Cookie name. Production uses the `__Host-` prefix, which forces Secure,
 * Path=/ and no Domain. Development runs over plain HTTP, so it has no prefix.
 */
export function adminCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-cpc_admin_session"
    : "cpc_admin_session";
}

/**
 * Attributes for setting or clearing the admin cookie. Clearing with
 * `maxAgeSeconds = 0` must use the same Secure and Path values, or browsers
 * keep a `__Host-` cookie.
 */
export function adminCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Client IP from proxy headers, or `null` when none is present. Headers are
 * only trustworthy behind a proxy that overwrites them. Vercel sets
 * `x-vercel-forwarded-for` itself.
 */
export function getClientIp(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
  ];
  for (const value of candidates) {
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/** Keyed hash for storage, so the raw address never reaches the database. */
export function hashClientIp(ip: string): string {
  return createHmac("sha256", getAdminSessionSecret()).update(ip).digest("hex");
}

export type AdminSessionRecord = { id: string; expiresAt: Date };

export async function createAdminSession(input: {
  adminId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<AdminSessionRecord> {
  return prisma.adminSession.create({
    data: {
      // A random UUID, so a session id cannot be guessed even if the secret leaks.
      id: randomUUID(),
      adminId: input.adminId,
      ipHash: input.ip ? hashClientIp(input.ip) : null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000),
    },
    select: { id: true, expiresAt: true },
  });
}

/** Signs the token that the admin cookie carries. Its `exp` matches the session row. */
export async function signAdminToken(
  session: AdminSessionRecord & { adminId: string },
): Promise<string> {
  return new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(session.adminId)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(session.expiresAt.getTime() / 1000))
    .sign(getAdminSessionSecret());
}

export type AdminTokenClaims = { adminId: string; sessionId: string };

/**
 * Claims from a correctly signed, unexpired token, or `null` for anything else.
 * A missing or malformed secret still throws, so it is never mistaken for a bad token.
 */
export async function verifyAdminToken(token: string): Promise<AdminTokenClaims | null> {
  const key = getAdminSessionSecret();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return { adminId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** Marks a session revoked. Calling it again does nothing. */
export async function revokeAdminSession(sessionId: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
