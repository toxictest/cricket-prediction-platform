import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local key-value storage, and the only place that knows the key names.
 *
 * The token lives here. AsyncStorage is unencrypted at rest, which is the normal
 * trade for a device the owner controls — the token is 30-day, scoped to this
 * platform, and moving money through it still needs the server's own rules
 * (PENDING-only reviews, the retained floor, the money-mode gate). Anything that
 * must survive a stolen device does not belong in this file.
 */
const TOKEN_KEY = "cpc.token";
const USER_KEY = "cpc.user";
/** The PKCE verifier while the browser is doing the sign-in. */
const VERIFIER_KEY = "cpc.pkce";
/** Which backend this install points at, when it differs from the baked-in default. */
const SERVER_URL_KEY = "cpc.serverUrl";

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    // A storage failure is not a sign-out: the caller keeps its in-memory value.
    return null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    /* best effort — see read() */
  }
}

export const getToken = () => read(TOKEN_KEY);
export const setToken = (token: string | null) => write(TOKEN_KEY, token);

/** Cached profile, so a cold start paints a name before the network answers. */
export const getCachedUser = async (): Promise<Record<string, unknown> | null> => {
  const raw = await read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};
export const setCachedUser = (user: unknown | null) =>
  write(USER_KEY, user === null ? null : JSON.stringify(user));

export const getStoredServerUrl = () => read(SERVER_URL_KEY);
export const setStoredServerUrl = (value: string | null) => write(SERVER_URL_KEY, value);

export const getPendingVerifier = () => read(VERIFIER_KEY);
export const setPendingVerifier = (value: string | null) => write(VERIFIER_KEY, value);
