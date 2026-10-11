import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { serverUrl } from "./server";
import { getToken } from "./storage";
import type { ApiError, ApiSuccess } from "../types/api";

/* ==========================================================================
   THE ONE HTTP CLIENT
   ==========================================================================

   Three jobs, all of them things every screen would otherwise repeat:

   1. Attach the bearer token. Screens never see it.
   2. Unwrap `{ ok, data }`, so a service function returns the thing it asked for.
   3. Turn a failure into one sentence the UI can show — the backend already
      writes those sentences ("Minimum 100 tokens must remain in wallet"), so the
      job here is to *not* replace them with "Request failed with status code 400".

   A 401 while a token is in play means the server no longer trusts this sign-in,
   so the session is dropped app-wide. That is what `onSignedOut` is for, and it is
   why no screen has to handle expiry itself.
   ========================================================================== */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function currentAccessToken(): string | null {
  return accessToken;
}

export const http = axios.create({
  // The compiled-in address as the starting value; the interceptor below replaces it
  // per request once (and if) this device has chosen a different one.
  baseURL: serverUrl(),
  timeout: 15000,
  headers: { accept: "application/json" },
});

http.interceptors.request.use(async (config) => {
  // Resolved per request, not once at module load, because a device may retarget its
  // server (see `lib/server.ts`) and the next tap has to go to the new address without
  // a restart. This is also why no screen imports the base URL.
  config.baseURL = serverUrl();
  const token = accessToken ?? (await getToken());
  if (token) config.headers.authorization = `Bearer ${token}`;
  return config;
});

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

export function onSignedOut(listener: Listener): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isApiError(error) && error.response?.status === 401 && accessToken) {
      for (const listener of signedOutListeners) listener();
    }
    return Promise.reject(error);
  },
);

export function isApiError(error: unknown): error is AxiosError {
  return error instanceof AxiosError || (typeof error === "object" && error !== null && "isAxiosError" in error);
}

/* ==========================================================================
   CALLS
   ========================================================================== */

export async function apiGet<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.get<ApiSuccess<T>>(path, config);
  return response.data.data;
}

export async function apiPost<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.post<ApiSuccess<T>>(path, body ?? {}, config);
  return response.data.data;
}

export type EtagResult<T> = {
  /** Null when the server answered 304 — nothing changed since `etag`. */
  data: T | null;
  etag: string | null;
  notModified: boolean;
};

/**
 * A conditional GET against the score endpoints, which all answer `If-None-Match`
 * with a 304. On a metered connection a poll that returns nothing is the whole
 * point: the app refreshes every 12 seconds without re-downloading the payload.
 *
 * `validateStatus` has to be widened because axios treats 304 as an error by
 * default and there is no body for it to have an error about.
 */
export async function apiGetWithEtag<T>(
  path: string,
  etag: string | null,
  params?: Record<string, string | number | undefined>,
): Promise<EtagResult<T>> {
  const response = await http.get<ApiSuccess<T>>(path, {
    params,
    headers: etag ? { "if-none-match": etag } : undefined,
    validateStatus: (status) => status === 200 || status === 304,
  });

  const nextEtag = response.headers.etag ?? etag;

  if (response.status === 304) {
    return { data: null, etag: nextEtag, notModified: true };
  }

  return { data: response.data.data, etag: nextEtag, notModified: false };
}

/* ==========================================================================
   ERRORS
   ========================================================================== */

export type UiError = {
  /** One sentence, safe to render. */
  message: string;
  /** The backend's machine code, when there was one — screens branch on it. */
  code: string | null;
  status: number | null;
};

function describe(error: unknown, fallback: string): UiError {
  if (isApiError(error)) {
    const status = error.response?.status ?? null;
    const body = error.response?.data as Partial<ApiError> | undefined;

    // The backend's own words win. They are written for the member who is about
    // to do the next thing, and they are the same words the web UI shows.
    if (body && typeof body.error === "string" && body.error.length > 0) {
      return { message: body.error, code: typeof body.code === "string" ? body.code : null, status };
    }

    if (error.code === "ECONNABORTED") {
      return { message: `The server at ${serverUrl()} took too long. Pull to retry.`, code: "TIMEOUT", status };
    }
    if (!error.response) {
      return {
        message: `Cannot reach ${serverUrl()}. Check the phone's network, and the address on the sign-in screen.`,
        code: "NETWORK",
        status,
      };
    }
    if (status === 404) return { message: "That is not there any more.", code: "NOT_FOUND", status };
    if (status && status >= 500) {
      return { message: "The server had a problem, not your phone. Try again in a moment.", code: "INTERNAL_ERROR", status };
    }
  }

  if (error instanceof Error && error.message) return { message: error.message, code: null, status: null };
  return { message: fallback, code: null, status: null };
}

/**
 * Turn anything thrown into the one shape a screen shows. `fallback` is for the
 * cases where the backend said nothing useful — a cancelled request, a parse
 * failure — and it should read like the sentence you would have written there.
 */
export function toUiError(error: unknown, fallback = "Something went wrong. Please try again."): UiError {
  return describe(error, fallback);
}

/** Just the sentence, for the 90% of callers that only display it. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return describe(error, fallback).message;
}
