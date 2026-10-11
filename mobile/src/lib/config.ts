/**
 * Where the backend lives.
 *
 * Inlined at build time by Expo from EXPO_PUBLIC_API_URL (see .env.example). The
 * defaults below are the three cases that actually come up: a LAN dev server, the
 * Android emulator's host alias, and a deployed URL.
 *
 *   iOS simulator / Web     http://localhost:3000
 *   Android emulator        http://10.0.2.2:3000   (localhost is the emulator itself)
 *   Physical phone (Expo)   http://<your-lan-ip>:3000
 */
const raw = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const API_URL = raw.replace(/\/+$/, "");

/** The custom scheme registered in app.json, used for the browser sign-in handoff. */
export const APP_SCHEME = "cricketmobile";

/** How long the app waits between live-score polls. The backend caches for 5s. */
export const SCORE_POLL_MS = Number(process.env.EXPO_PUBLIC_SCORE_POLL_MS ?? 12000);

/** Lists and the wallet refresh when the app comes back to the foreground. */
export const WALLET_POLL_MS = Number(process.env.EXPO_PUBLIC_WALLET_POLL_MS ?? 30000);
