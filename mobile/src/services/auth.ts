import { apiGet, apiPost } from "../lib/api";
import type { MemberOverview, MobileSignInResult } from "../types/api";

/**
 * Sign-in, and the snapshot that proves it.
 *
 * `POST /api/auth/mobile` is the only endpoint that issues a bearer token, and it
 * accepts whichever credential the flow in use can produce. There is no
 * email/password route to fall back to — that is the backend's design, and this
 * file follows it rather than inventing a weaker door.
 */

export function exchangeHandoffCode(input: { code: string; verifier: string }): Promise<MobileSignInResult> {
  return apiPost<MobileSignInResult>("/api/auth/mobile", input);
}

export function signInWithGoogleIdToken(input: { idToken: string; referralCode?: string | null }): Promise<MobileSignInResult> {
  return apiPost<MobileSignInResult>("/api/auth/mobile", input);
}

export function signInWithGoogleAccessToken(input: { accessToken: string }): Promise<MobileSignInResult> {
  return apiPost<MobileSignInResult>("/api/auth/mobile", input);
}

/**
 * `GET /api/me` — the snapshot: the member, their wallet totals, their stats, and
 * any warning the server wants the UI to surface (a missing wallet row, say).
 *
 * Used as the boot check as well as the profile screen, because it answers the
 * question "is this token still good?" and the question "who am I?" in one call.
 */
export function fetchOverview(): Promise<MemberOverview> {
  return apiGet<MemberOverview>("/api/me");
}

/** Public probe, handy in a debug banner and cheap enough to call on boot. */
export function fetchHealth(): Promise<{ status: string; database: string }> {
  return apiGet<{ status: string; database: string }>("/api/health");
}
