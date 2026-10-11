import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking } from "react-native";
import { API_URL, APP_SCHEME } from "../lib/config";
import { onSignedOut, setAccessToken, toUiError, type UiError } from "../lib/api";
import { createPkcePair } from "../lib/pkce";
import { getCachedUser, getPendingVerifier, setCachedUser, setPendingVerifier, setToken, getToken } from "../lib/storage";
import { restoreServerUrl } from "../lib/server";
import { exchangeHandoffCode, fetchOverview } from "../services/auth";
import type { MemberOverview } from "../types/api";

/* ==========================================================================
   AUTH STATE
   ==========================================================================

   Sign-in on a phone, done the only way this backend allows: the app opens the
   system browser on `/mobile/start`, NextAuth and Google do what they already do
   there, and a short-lived code comes back to this app with a PKCE verifier only
   this device holds.

   Three states, and `booting` is not a formality: a cold start with a stored
   token has to ask the server whether that token still means anything before the
   app shows a balance, or a revoked session renders last week's numbers.
   ========================================================================== */

export type AuthStatus = "booting" | "signedOut" | "signedIn";

type AuthValue = {
  status: AuthStatus;
  user: MemberOverview["user"] | null;
  overview: MemberOverview | null;
  error: UiError | null;
  busy: boolean;
  /** Opens the browser handoff. Resolves once the browser is open, not once signed in. */
  startGoogleSignIn: (referralCode?: string | null) => Promise<void>;
  /** Redeems a code the browser handed back (or that a developer pasted). */
  completeWithCode: (code: string, referralCode?: string | null) => Promise<boolean>;
  /** Adopts a bearer token directly. The dev path: `npm run mobile:token` on the backend. */
  useToken: (token: string) => Promise<boolean>;
  signOut: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/** `cricketmobile://auth?code=…` → the code, or null for any other URL. */
function readCodeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = new RegExp(`^${APP_SCHEME}://auth[?&]code=([^&]+)`, "i").exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [user, setUser] = useState<MemberOverview["user"] | null>(null);
  const [overview, setOverview] = useState<MemberOverview | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Keeps the pending referral code alive across the browser round-trip, which is
  // the mobile equivalent of the web's `cpc_ref` cookie.
  const pendingReferral = useRef<string | null>(null);

  const adopt = useCallback(async (token: string): Promise<boolean> => {
    setAccessToken(token);
    await setToken(token);
    try {
      const next = await fetchOverview();
      setOverview(next);
      setUser(next.user);
      await setCachedUser(next.user as unknown as Record<string, unknown>);
      setStatus("signedIn");
      setError(null);
      return true;
    } catch (thrown) {
      // A token the server will not honour is no token at all. Leaving it stored
      // would put the app back here on every launch, forever.
      setAccessToken(null);
      await setToken(null);
      setError(toUiError(thrown, "Sign-in did not complete. Try again."));
      setStatus("signedOut");
      return false;
    }
  }, []);

  // ---- cold start: a stored token, and a cached profile to paint immediately ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The server address first: a stored token is worthless if the request it belongs
      // to goes to the host baked into the binary instead of the one this device chose.
      await restoreServerUrl();
      const stored = await getToken();
      if (!stored) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      const cached = await getCachedUser();
      if (!cancelled && cached) setUser(cached as unknown as MemberOverview["user"]);

      setAccessToken(stored);
      try {
        const next = await fetchOverview();
        if (cancelled) return;
        setOverview(next);
        setUser(next.user);
        await setCachedUser(next.user as unknown as Record<string, unknown>);
        setStatus("signedIn");
      } catch (thrown) {
        if (cancelled) return;
        const ui = toUiError(thrown, "Could not reach the server.");
        // Only a rejection clears the session; a network timeout keeps the token,
        // because on a phone the honest answer to "is this still valid?" is "unknown".
        if (ui.code === "UNAUTHORIZED" || ui.status === 401) {
          setAccessToken(null);
          await setToken(null);
          setStatus("signedOut");
        } else {
          setError(ui);
          setStatus("signedIn");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const completeWithCode = useCallback(
    async (code: string, referralCode?: string | null): Promise<boolean> => {
      setBusy(true);
      try {
        const verifier = await getPendingVerifier();
        if (!verifier) {
          setError({
            message: "This sign-in was not started on this device. Start it again from the app.",
            code: "MISSING_VERIFIER",
            status: null,
          });
          return false;
        }
        const result = await exchangeHandoffCode({ code, verifier });
        await setPendingVerifier(null);
        return await adopt(result.token);
      } catch (thrown) {
        setError(toUiError(thrown, "Google sign-in did not finish."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  // ---- the deep link back from the browser ----
  useEffect(() => {
    const subscription = Linking.addEventListener("url", (event) => {
      const code = readCodeFromUrl(event.url);
      if (code) void completeWithCode(code, pendingReferral.current);
    });
    (async () => {
      const initial = readCodeFromUrl(await Linking.getInitialURL());
      if (initial) {
        // A code delivered by a cold start still needs the boot check to settle
        // first, or the two would race over `status`.
        setTimeout(() => void completeWithCode(initial, pendingReferral.current), 0);
      }
    })();
    return () => subscription.remove();
  }, [completeWithCode]);

  const startGoogleSignIn = useCallback(async (referralCode?: string | null) => {
    setError(null);
    setBusy(true);
    try {
      pendingReferral.current = referralCode ?? null;
      const { verifier, challenge } = await createPkcePair();
      await setPendingVerifier(verifier);
      const url = `${API_URL}/mobile/start?challenge=${encodeURIComponent(challenge)}`;
      const opened = await Linking.openURL(url);
      if (!opened) throw new Error("Could not open the browser.");
    } catch (thrown) {
      setError(toUiError(thrown, "Could not open the browser for sign-in."));
    } finally {
      setBusy(false);
    }
  }, []);

  const useToken = useCallback(
    async (token: string): Promise<boolean> => {
      setBusy(true);
      try {
        return await adopt(token.trim().replace(/^bearer\s+/i, ""));
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const signOut = useCallback(() => {
    setAccessToken(null);
    void setToken(null);
    void setCachedUser(null);
    setOverview(null);
    setUser(null);
    setStatus("signedOut");
    setError(null);
  }, []);

  // Any 401 from any screen ends the session here, once.
  useEffect(() => onSignedOut(signOut), [signOut]);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchOverview();
      setOverview(next);
      setUser(next.user);
      setError(null);
    } catch (thrown) {
      const ui = toUiError(thrown, "Could not refresh your profile.");
      if (ui.code !== "UNAUTHORIZED") setError(ui);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, overview, error, busy, startGoogleSignIn, completeWithCode, useToken, signOut, refresh }),
    [status, user, overview, error, busy, startGoogleSignIn, completeWithCode, useToken, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
