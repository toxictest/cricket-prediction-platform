import { NextResponse } from "next/server";
import type { ApiError } from "@/types";

/* ==========================================================================
   SHARED HTTP HELPERS
   ==========================================================================

   Small, route-facing utilities that are not specific to any one domain. The
   wallet routes and the payment routes both need them, so they live here
   instead of being copied.
   ========================================================================== */

/** Member balances, ledger rows and payment claims are personal and never cacheable. */
export function apiJson(body: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** 401 for a missing or unusable member session. Same shape on every member route. */
export function unauthorizedResponse(): NextResponse {
  const body: ApiError = {
    ok: false,
    error: "Not authenticated",
    code: "UNAUTHORIZED",
  };
  return apiJson(body, 401);
}

/**
 * 503 for a feature that exists but is switched off by configuration.
 * `Retry-After` tells an honest client to back off rather than hammer.
 */
export function featureDisabledResponse(message: string, code: ApiError["code"]): NextResponse {
  const body: ApiError = { ok: false, error: message, code };
  return apiJson(body, 503, { "Retry-After": "3600" });
}

export type JsonBody = { ok: true; data: unknown } | { ok: false; response: NextResponse };

/**
 * Reads a JSON request body.
 *
 * The content-type check is not decoration. A cross-site HTML form can POST
 * `text/plain`, `application/x-www-form-urlencoded` or `multipart/form-data`
 * without a CORS preflight, and our session cookies are carried on such a
 * request. Requiring `application/json` means a browser will only send it after
 * a preflight the attacker cannot survive. Every state-changing cookie-authed
 * POST in this app uses this guard.
 *
 * `allowEmpty` accepts a body-less action such as approving a payment, where
 * the endpoint takes no fields.
 */
export async function readJsonBody(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<JsonBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const body: ApiError = {
      ok: false,
      error: "Send the request as application/json.",
      code: "UNSUPPORTED_MEDIA_TYPE",
    };
    return { ok: false, response: apiJson(body, 415) };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    const body: ApiError = { ok: false, error: "Request body could not be read.", code: "INVALID_JSON" };
    return { ok: false, response: apiJson(body, 400) };
  }

  if (text.trim().length === 0) {
    if (options.allowEmpty) return { ok: true, data: {} };
    const body: ApiError = { ok: false, error: "A JSON body is required.", code: "INVALID_JSON" };
    return { ok: false, response: apiJson(body, 400) };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    const body: ApiError = { ok: false, error: "Request body must be JSON.", code: "INVALID_JSON" };
    return { ok: false, response: apiJson(body, 400) };
  }
}
