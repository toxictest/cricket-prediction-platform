import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "@/lib/prisma";
import { HandoffError, redeemHandoffCode } from "@/lib/mobile-handoff";
import { provisionUser } from "@/lib/user";
import { memberAuthConfigured, mintMemberToken, type MintedMemberToken } from "@/lib/member-token";

/* ==========================================================================
   MOBILE SIGN-IN — Google ID token in, member bearer token out
   ==========================================================================

   The web flow is NextAuth's OAuth redirect dance, which a native app cannot
   complete with a cookie jar. So the app does the OAuth hand-off itself
   (`expo-auth-session`), lands on a Google **ID token**, and brings it here.

   What this module decides:

   - The ID token is real: signed by Google, not expired, issued to
     *this* project's client id.
   - The email is one Google says is verified. That check is not pedantry —
     Google will happily return an `email` the account owner never confirmed,
     and this system keys member rows on email. Without the check, anyone could
     register against somebody else's address.
   - The member row is created through `provisionUser()`, the exact function the
     web callback uses, so a phone sign-in and a browser sign-in produce the same
     row, the same referral behaviour and the same auto-created wallet.
   - What goes back to the phone is a `member-token` JWT, not the Google token.
     The app never holds a Google access token, so a leaked app storage blob
     grants access to this platform only, and only for as long as this server
     says (30 days, revocable by deleting the member row).
   ========================================================================== */

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

/**
 * Google's public keys. Fetched lazily and cached by `jose`; the URL is stable
 * and documented, so there is nothing to configure.
 */
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type MobileAuthErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

export class MobileAuthError extends Error {
  constructor(
    public readonly code: MobileAuthErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MobileAuthError";
  }
}

export type GoogleIdentity = {
  googleId: string;
  email: string;
  name: string | null;
  image: string | null;
};

/**
 * Verifies a Google ID token and returns the identity it asserts.
 *
 * Exported separately so the exchange below can be tested without a network
 * call to Google, and so a future provider (Apple, a test harness) can be
 * dropped in behind the same `provisionUser` path.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const audiences = allowedGoogleAudiences();
  if (audiences.length === 0) {
    throw new MobileAuthError(
      "AUTH_NOT_CONFIGURED",
      "Google sign-in is not configured on this server.",
      503,
    );
  }

  let payload: JWTPayload & Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks, {
      issuer: [...GOOGLE_ISSUERS],
      clockTolerance: 30,
      // Audience is checked by hand below: jose accepts one expected value, and a
      // native build legitimately presents a different client id from the web one.
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    // Never echo Google's message back: it can name the client id, and the
    // failure is not the caller's to diagnose.
    throw new MobileAuthError(
      "UNAUTHORIZED",
      "Google could not verify this sign-in. Please try again.",
      detail.includes("JWSTimeout") || detail.includes("Network") ? 502 : 401,
    );
  }

  if (typeof payload.aud === "string" ? !audiences.includes(payload.aud) : !payload.aud?.some((a) => audiences.includes(String(a)))) {
    throw new MobileAuthError(
      "UNAUTHORIZED",
      "This sign-in token was issued for a different application.",
      401,
    );
  }

  if (payload.email_verified !== true) {
    throw new MobileAuthError(
      "FORBIDDEN",
      "Google says this email address is not verified. Verify it with Google, then sign in again.",
      403,
    );
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const googleId = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !googleId) {
    throw new MobileAuthError("UNAUTHORIZED", "Google did not return an email for this account.", 401);
  }

  return {
    googleId,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    image: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/**
 * Which Google client ids this server trusts.
 *
 * `GOOGLE_CLIENT_ID` is the web one NextAuth uses. A native build gets its ID
 * token from an **Android/iOS** Google client, whose id is a different value —
 * that mismatch is the single most common reason "Google works in the browser
 * and 401s in the app". `GOOGLE_MOBILE_CLIENT_ID` exists so both are trusted
 * without pretending they are the same thing.
 */
export function allowedGoogleAudiences(): string[] {
  return [process.env.GOOGLE_MOBILE_CLIENT_ID, process.env.GOOGLE_CLIENT_ID]
    .map((value) => (value ?? "").trim())
    // A placeholder is not a client id; trusting it would trust nothing at all.
    .filter((value) => value.length > 0 && !value.includes("replace-me") && !value.endsWith(".apps.googleusercontent.com-replace"));
}

export type MobileSignInInput = {
  /** A Google ID token, straight from a native Google SDK. */
  idToken?: string;
  /** An OAuth access token, for the Expo AuthSession flow. */
  accessToken?: string;
  /** A browser handoff code, for the "sign in on the phone, consent in the browser" flow. */
  code?: string;
  /** The PKCE verifier that goes with `code`. */
  verifier?: string;
  referralCode?: string | null;
};

/** Which credential the caller actually provided, in the order the app tries them. */
export type MobileCredential =
  | { kind: "idToken"; value: string }
  | { kind: "accessToken"; value: string }
  | { kind: "code"; code: string; verifier: string };

export function pickCredential(input: MobileSignInInput): MobileCredential {
  const idToken = (input.idToken ?? "").trim();
  if (idToken) return { kind: "idToken", value: idToken };

  const accessToken = (input.accessToken ?? "").trim();
  if (accessToken) return { kind: "accessToken", value: accessToken };

  const code = (input.code ?? "").trim();
  const verifier = (input.verifier ?? "").trim();
  if (code) {
    if (!verifier) {
      throw new MobileAuthError(
        "VALIDATION_ERROR",
        "A sign-in code must be exchanged with its verifier.",
        400,
      );
    }
    return { kind: "code", code, verifier };
  }

  throw new MobileAuthError(
    "VALIDATION_ERROR",
    "Send idToken, accessToken or code with verifier.",
    400,
  );
}

export type MobileSignInResult = {
  token: string;
  tokenType: "Bearer";
  expiresAt: number;
  expiresInSeconds: number;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    referralCode: string | null;
  };
  /** True when this sign-in created the member row. */
  created: boolean;
};

/* ==========================================================================
   ACCESS TOKENS — the Expo AuthSession path
   ========================================================================== */

const GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_FETCH_TIMEOUT_MS = 5000;

async function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) });
  } catch {
    // Google is unreachable. The client did nothing wrong, so this is a 5xx.
    throw new MobileAuthError(
      "INTERNAL_ERROR",
      "Google could not be reached. Please try again.",
      502,
    );
  }
}

/**
 * Verifies an OAuth *access* token by asking Google about it, twice and for two
 * different reasons:
 *
 *   1. `/tokeninfo` says which client the token was issued to. Without this
 *      check, an access token from any OAuth client on the internet — a malicious
 *      one with a `gmail.readonly` scope, say — would be accepted here.
 *   2. `/userinfo` is where the identity actually lives.
 *
 * `email_verified` is checked on the userinfo response, for the same reason it is
 * checked in the ID-token path: this system keys member rows on email.
 */
export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleIdentity> {
  const audiences = allowedGoogleAudiences();
  if (audiences.length === 0) {
    throw new MobileAuthError(
      "AUTH_NOT_CONFIGURED",
      "Google sign-in is not configured on this server.",
      503,
    );
  }

  const tokenInfoResponse = await googleFetch(
    `${GOOGLE_TOKENINFO}?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!tokenInfoResponse.ok) {
    throw new MobileAuthError(
      "UNAUTHORIZED",
      "Google rejected this sign-in token. Please try again.",
      401,
    );
  }
  const tokenInfo = (await tokenInfoResponse.json()) as Record<string, unknown>;
  const issuedTo = [tokenInfo.aud, tokenInfo.azp].filter((v): v is string => typeof v === "string");
  if (issuedTo.length === 0 || !issuedTo.some((value) => audiences.includes(value))) {
    throw new MobileAuthError(
      "UNAUTHORIZED",
      "This sign-in token was issued for a different application.",
      401,
    );
  }

  const userInfoResponse = await googleFetch(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!userInfoResponse.ok) {
    throw new MobileAuthError("UNAUTHORIZED", "Google rejected this sign-in token.", 401);
  }
  const profile = (await userInfoResponse.json()) as Record<string, unknown>;

  if (profile.email_verified !== true) {
    throw new MobileAuthError(
      "FORBIDDEN",
      "Google says this email address is not verified. Verify it with Google, then sign in again.",
      403,
    );
  }

  const email = typeof profile.email === "string" ? profile.email.trim() : "";
  const googleId = typeof profile.sub === "string" ? profile.sub : "";
  if (!email || !googleId) {
    throw new MobileAuthError("UNAUTHORIZED", "Google did not return an email for this account.", 401);
  }

  return {
    googleId,
    email,
    name: typeof profile.name === "string" ? profile.name : null,
    image: typeof profile.picture === "string" ? profile.picture : null,
  };
}

/** A browser handoff code is already an identity this server issued, so it needs no Google call. */
async function identityFromHandoff(code: string, verifier: string): Promise<{ userId: string; email: string | null }> {
  try {
    return await redeemHandoffCode(code, verifier);
  } catch (error) {
    if (error instanceof HandoffError) {
      throw new MobileAuthError("UNAUTHORIZED", error.message, 401);
    }
    throw error;
  }
}

/**
 * The whole exchange. `verify` is injectable for the same reason the Google call
 * is isolated above: the unit tests assert this logic without reaching for
 * Google's keys, which a sandbox cannot do and a CI run should not have to.
 */
export async function signInWithMobileCredential(
  input: MobileSignInInput,
  deps: {
    verifyIdToken?: (idToken: string) => Promise<GoogleIdentity>;
    verifyAccessToken?: (accessToken: string) => Promise<GoogleIdentity>;
  } = {},
): Promise<MobileSignInResult> {
  if (!memberAuthConfigured()) {
    throw new MobileAuthError(
      "AUTH_NOT_CONFIGURED",
      "Mobile sign-in is not configured on this server.",
      503,
    );
  }

  const credential = pickCredential(input);

  // A handoff code names the member directly; anything from a phone has to be
  // attributed to Google first.
  if (credential.kind === "code") {
    const resolved = await identityFromHandoff(credential.code, credential.verifier);
    const user = await prisma.user.findUnique({
      where: { id: resolved.userId },
      select: { id: true, name: true, email: true, image: true, referralCode: true },
    });
    if (!user) {
      throw new MobileAuthError(
        "UNAUTHORIZED",
        "That account no longer exists. Please register again.",
        401,
      );
    }
    const minted = await mintMemberToken({ userId: user.id, email: user.email });
    return {
      ...minted,
      tokenType: "Bearer",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        referralCode: user.referralCode,
      },
      created: false,
    };
  }

  const identity =
    credential.kind === "idToken"
      ? await (deps.verifyIdToken ?? verifyGoogleIdToken)(credential.value)
      : await (deps.verifyAccessToken ?? verifyGoogleAccessToken)(credential.value);

  const { user, created } = await provisionUser({
    googleId: identity.googleId,
    email: identity.email,
    name: identity.name ?? "",
    image: identity.image,
    referralCode: input.referralCode ?? null,
  });

  const minted: MintedMemberToken = await mintMemberToken({
    userId: user.id,
    email: user.email,
  });

  return {
    ...minted,
    tokenType: "Bearer",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      referralCode: user.referralCode,
    },
    created,
  };
}

/**
 * Kept as a named entry point because the web-side tests and any future caller
 * that only ever has an ID token should not have to know about the other two.
 */
export async function signInWithGoogleIdToken(
  input: { idToken: string; referralCode?: string | null },
  deps: { verify?: (idToken: string) => Promise<GoogleIdentity> } = {},
): Promise<MobileSignInResult> {
  return signInWithMobileCredential(
    { idToken: input.idToken, referralCode: input.referralCode ?? null },
    { verifyIdToken: deps.verify },
  );
}
