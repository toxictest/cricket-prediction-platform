import axios from "axios";
import { API_URL as COMPILED_API_URL } from "./config";
import { getStoredServerUrl, setStoredServerUrl } from "./storage";

/*
 * Which backend this install talks to.
 *
 * `EXPO_PUBLIC_API_URL` is compiled into the bundle, which is right for a deployed app and
 * useless for a phone pointed at a laptop: the LAN IP changes with the Wi-Fi, and rebuilding an
 * APK to follow it is a five-minute punishment for a typo. So the compiled value is the *default*
 * here, and a device may carry an override in AsyncStorage.
 *
 * Two rules keep that from becoming a footgun:
 *   - The override never unlocks anything. A signed-in session is a bearer token issued by
 *     whatever server was in use at the time; switching servers does not carry it over, and the
 *     login screen is the only place the address can be edited, which is where a member is by
 *     definition not signed in to the new one yet.
 *   - An override that fails to validate is discarded on read rather than trusted. A half-saved
 *     URL that silently sends requests to the wrong host is worse than the compiled default.
 */

let currentUrl = COMPILED_API_URL;

export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

/** The address every request goes to, right now. */
export function serverUrl(): string {
  return currentUrl;
}

/** The address baked into this build, for the "reset" affordance. */
export function compiledUrl(): string {
  return COMPILED_API_URL;
}

/**
 * True when this build was baked with a plain-http URL. The login screen offers the address editor
 * only then, so a deployed app never shows a field that would point a member at a hostile server.
 */
export function addressEditable(): boolean {
  return !COMPILED_API_URL.startsWith("https://");
}

/** Scheme + host + optional port, nothing else. Rejects the shapes that break every request. */
export function normaliseUrl(input: string): UrlResult {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed === "") return { ok: false, error: "Type an address, like http://192.168.1.20:3000" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a URL. Include http:// or https://" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https work here." };
  }
  if (!parsed.hostname) return { ok: false, error: "No host in that address." };
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, error: "Leave off the path — the app adds /api itself." };
  }
  if (parsed.search || parsed.hash) return { ok: false, error: "No query string or # fragment." };
  return { ok: true, url: trimmed };
}

/** Read the stored override at launch, before anything is allowed to make a request. */
export async function restoreServerUrl(): Promise<void> {
  const stored = await getStoredServerUrl();
  if (!stored) return;
  const result = normaliseUrl(stored);
  // Validated again on the way in: AsyncStorage is a file, and a hand-edited or half-written
  // value must not become the address every request goes to.
  if (result.ok) currentUrl = result.url;
  else await setStoredServerUrl(null);
}

/** Point this install at `input`, or at the build default when `input` is empty. */
export async function applyServerUrl(input: string): Promise<UrlResult> {
  if (input.trim() === "" || input.trim().replace(/\/+$/, "") === COMPILED_API_URL) {
    currentUrl = COMPILED_API_URL;
    await setStoredServerUrl(null);
    return { ok: true, url: currentUrl };
  }
  const result = normaliseUrl(input);
  if (!result.ok) return result;
  currentUrl = result.url;
  await setStoredServerUrl(result.url);
  return result;
}

export type ProbeResult = { ok: boolean; detail: string };

/**
 * Ask the server if it is there, before a member commits to an address they typed on a phone.
 *
 * `/api/health` is the endpoint for this: it answers without a session, and it answers with JSON
 * even when the database is down (a 503 with a body), which tells the two failure modes apart —
 * "the phone cannot reach that host" versus "the host is reachable and its database is broken".
 */
export async function probeServer(url: string): Promise<ProbeResult> {
  const result = normaliseUrl(url);
  if (!result.ok) return { ok: false, detail: result.error };
  try {
    const response = await axios.get(`${result.url}/api/health`, {
      timeout: 7000,
      headers: { accept: "application/json" },
      // No bearer, no cookies: this is a reachability check, not a request as the member.
      transformRequest: [(data: unknown) => data],
    });
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});
    const looksLikeUs = body.includes('"ok"');
    if (!looksLikeUs) {
      return {
        ok: false,
        detail: `HTTP ${response.status} came back, but not as this platform's JSON — is that port your API server?`,
      };
    }
    return { ok: true, detail: `HTTP ${response.status} · server answered on ${result.url}` };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (typeof status === "number") {
        // A 503 from /api/health still proves the address is right.
        return { ok: status < 500, detail: `HTTP ${status} from ${result.url} — the address resolves and something is listening.` };
      }
      if (error.code === "ECONNABORTED") {
        return { ok: false, detail: "No answer within 7s. Wrong IP, or the phone and the laptop are on different networks." };
      }
      if (error.code === "ERR_NETWORK" || !error.response) {
        return {
          ok: false,
          detail:
            "Could not connect. Check the laptop's firewall, that the dev server listens on 0.0.0.0, and that this APK is a debug build (release builds refuse plain http).",
        };
      }
    }
    return { ok: false, detail: "Unexpected failure while testing that address." };
  }
}
