import { createHash, randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { getMemberTokenSecret } from "@/lib/member-token";

/* ==========================================================================
   HANDOFF CODES — how a browser sign-in becomes a phone sign-in
   ==========================================================================

   A phone cannot use the web's cookie session, and asking an app to hold a
   Google client secret is not an option. So the app opens the system browser on
   `/mobile/start`, the existing NextAuth + Google flow runs there (where it has
   always worked), and this short-lived code comes back to the app through its
   custom scheme. The app then trades the code for a member token.

   The code is a signed JWT rather than a database row for one reason: this
   deployment target is Vercel, where process memory is not shared between
   instances, so a "used codes" table is the only thing that could make single-use
   exact. A stateless 120-second code gets 99% of the way there without a
   migration, and the PKCE verifier (which never leaves the app) is what actually
   stops a code stolen from the deep link from being usable.

   If this ever needs to be exact, the swap is mechanical: store `{challenge,
   usedAt}` on the `User` row or a new table and delete on read.
   ========================================================================== */

export const HANDOFF_TTL_SECONDS = 120;

const HANDOFF_ISSUER = "cpc-member";
const HANDOFF_AUDIENCE = "cpc-mobile-handoff";
const HANDOFF_TYPE = "mobile-handoff";

/** The scheme the app registers in app.json. */
export const MOBILE_REDIRECT_SCHEME = "cricketmobile";

/**
 * Best-effort single-use list. Cleared as codes expire, so it cannot grow without
 * bound. Across two serverless instances a code could be redeemed twice inside its
 * 120-second window — which PKCE still makes useless to a thief.
 */
const spent = new Map<string, number>();

function sweepExpired(now: number): void {
  for (const [jti, expiresAtMs] of spent) {
    if (now >= expiresAtMs) spent.delete(jti);
  }
}

export type HandoffCode = {
  code: string;
  expiresInSeconds: number;
  /** Where the browser should send the member next. */
  redirectUri: string;
};

export async function mintHandoffCode(input: {
  userId: string;
  email: string | null;
  /** S256 challenge of the app's PKCE verifier. */
  challenge: string;
}): Promise<HandoffCode> {
  const key = getMemberTokenSecret();
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const code = await new SignJWT({
    typ: HANDOFF_TYPE,
    uid: input.userId,
    email: input.email,
    ch: input.challenge,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(HANDOFF_ISSUER)
    .setAudience(HANDOFF_AUDIENCE)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + HANDOFF_TTL_SECONDS)
    .sign(key);

  return {
    code,
    expiresInSeconds: HANDOFF_TTL_SECONDS,
    redirectUri: `${MOBILE_REDIRECT_SCHEME}://auth?code=${encodeURIComponent(code)}`,
  };
}

/** Base64url of the SHA-256 of the verifier — the S256 method, and only that. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export class HandoffError extends Error {
  constructor(
    public readonly code: "INVALID_CODE" | "CODE_EXPIRED",
    message: string,
  ) {
    super(message);
    this.name = "HandoffError";
  }
}

/**
 * Redeems a handoff code. Throws `HandoffError` on anything that is not a clean
 * match, including a verifier that does not hash to the stored challenge.
 */
export async function redeemHandoffCode(
  code: string,
  verifier: string,
): Promise<{ userId: string; email: string | null }> {
  const key = getMemberTokenSecret();

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(code, key, {
      issuer: HANDOFF_ISSUER,
      audience: HANDOFF_AUDIENCE,
      clockTolerance: 5,
    }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new HandoffError(
      name.includes("Expired") ? "CODE_EXPIRED" : "INVALID_CODE",
      name.includes("Expired")
        ? "That sign-in link expired. Open sign-in again on the phone."
        : "That sign-in link is not valid.",
    );
  }

  if (payload.typ !== HANDOFF_TYPE || typeof payload.uid !== "string" || !payload.uid) {
    throw new HandoffError("INVALID_CODE", "That sign-in link is not valid.");
  }
  if (typeof payload.ch !== "string" || !payload.ch) {
    throw new HandoffError("INVALID_CODE", "That sign-in link is not valid.");
  }

  const trimmed = verifier.trim();
  if (!trimmed || pkceChallenge(trimmed) !== payload.ch) {
    throw new HandoffError(
      "INVALID_CODE",
      "That sign-in link does not match this device. Start sign-in again.",
    );
  }

  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const now = Date.now();
  sweepExpired(now);
  if (jti && spent.has(jti)) {
    throw new HandoffError("INVALID_CODE", "That sign-in link has already been used.");
  }
  if (jti) spent.set(jti, now + (HANDOFF_TTL_SECONDS + 30) * 1000);

  return {
    userId: payload.uid,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

/** The exact query the app should open in a browser to start a handoff. */
export function mobileStartPath(challenge: string): string {
  const params = new URLSearchParams({ challenge });
  return `/mobile/start?${params.toString()}`;
}
