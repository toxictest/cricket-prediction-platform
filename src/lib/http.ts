import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError, ApiSuccess } from "@/types";
import { MAX_PAGE_SIZE } from "@/lib/pagination";

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

/**
 * The one error body builder. Every 4xx and 5xx in the app goes through this or a
 * thin wrapper over it, which is what makes "consistent response format" a
 * property rather than a convention: a route cannot improvise `message`, `errors`
 * or a bare status text, because there is no other way to say "no".
 */
export function errorResponse(
  code: ApiError["code"],
  status: number,
  error: string,
  options: { details?: unknown; headers?: Record<string, string> } = {},
): NextResponse {
  const body: ApiError = {
    ok: false,
    error,
    code,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
  return apiJson(body, status, options.headers);
}

/** 400 with Zod's `flatten()` attached, so a form can put the message on the field. */
export function validationErrorResponse(details?: unknown, error = "Invalid request"): NextResponse {
  return errorResponse("VALIDATION_ERROR", 400, error, { details });
}

/** 404 for a missing *thing*; a missing *route* is Next's own 404 page, not this. */
export function notFoundResponse(error = "Not found"): NextResponse {
  return errorResponse("NOT_FOUND", 404, error);
}

/** 429. `Retry-After` is not decoration: an honest client stops hammering. */
export function rateLimitedResponse(error = "Too many requests", retryAfterSeconds = 60): NextResponse {
  return errorResponse("RATE_LIMITED", 429, error, {
    headers: { "Retry-After": String(Math.max(1, Math.round(retryAfterSeconds))) },
  });
}

/* ==========================================================================
   THE LAST LINE OF DEFENCE
   ========================================================================== */

/**
 * Scrubs credentials out of a string that is about to be logged, or shown in a
 * development error detail.
 *
 * Why this exists: Prisma puts the connection string in its own error messages
 * (`Can't reach database server at postgresql://user:password@host:5432/db`), and
 * a stack trace can carry a bearer token. Both are exactly the thing a "show the
 * error in development" affordance tends to publish. So the text is redacted
 * before it leaves the process, whatever the caller meant to include.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]*@/g, "$1***@")
    .replace(
      /(\b(?:password|passwd|secret|token|authorization|api[_-]?key)\b["']?\s*[=:]\s*)(?:(?:bearer|basic)\s+)?["']?[^\s"',;]+["']?/gi,
      "$1***",
    )
    // Three dot-separated base64url runs is a JWT and nothing else a log line
    // would carry, so this is safe to scrub wholesale.
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "***.***.***");
}

/**
 * Turns an error nobody anticipated into the same envelope everything else uses.
 *
 * Without this, an uncaught throw in a route handler becomes Next's HTML error
 * page with a stack trace — an API client doing `response.json()` chokes on it,
 * and the stack is a gift to anybody probing the endpoint. The message is logged
 * (redacted) and only echoed in development, matching `featureDisabledResponse`
 * in politeness: the client gets a code, the operator gets the log.
 */
/**
 * The API's one way to write a 500 to the log.
 *
 * Two rules, both learned the hard way: never hand `console.error` the raw error
 * object — a Prisma or fetch failure can carry the connection string or a signed
 * URL inside it, and this project's logs are a shared surface — and do log the
 * stack anyway, because a redacted stack is still the difference between a
 * five-minute diagnosis and a bug report that says "it returned 500".
 */
export function logApiError(context: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  console.error(redactSecrets(`[${context}] unhandled error: ${detail}${stack}`));
}

export function internalErrorResponse(error: unknown, context: string): NextResponse {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  logApiError(context, error);

  return errorResponse(
    "INTERNAL_ERROR",
    500,
    "Something went wrong on our side. The details were logged.",
    process.env.NODE_ENV === "development" ? { details: { detail: redactSecrets(detail) } } : undefined,
  );
}

/**
 * Wraps a route handler so an unexpected throw can never escape as HTML.
 *
 * Domain mappers (`paymentErrorResponse` and friends) stay — they turn *expected*
 * failures into the right status and code, and `guardRoute` only catches what fell
 * through them. Every route in the app is wrapped, which is asserted mechanically
 * by `tests/api-envelope.test.ts`; a new route that forgets the wrapper fails that
 * test rather than failing a client at 2 a.m. with `SyntaxError: Unexpected token
 * <`.
 */
export function guardRoute<Result extends Response, Args extends unknown[]>(
  context: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result | NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return internalErrorResponse(error, context);
    }
  };
}

/** The success half of the envelope, so a route never hand-rolls `{ ok: true }`. */
export function apiSuccess<T>(data: T, status = 200, headers?: Record<string, string>): NextResponse {
  const body: ApiSuccess<T> = { ok: true, data };
  return apiJson(body, status, headers);
}

/** 401 for a missing or unusable member session. Same shape on every member route. */
export function unauthorizedResponse(): NextResponse {
  return errorResponse("UNAUTHORIZED", 401, "Not authenticated");
}

/**
 * 503 for a feature that exists but is switched off by configuration.
 * `Retry-After` tells an honest client to back off rather than hammer.
 */
export function featureDisabledResponse(message: string, code: ApiError["code"]): NextResponse {
  return errorResponse(code, 503, message, { headers: { "Retry-After": "3600" } });
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
    return {
      ok: false,
      response: errorResponse("UNSUPPORTED_MEDIA_TYPE", 415, "Send the request as application/json."),
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse("INVALID_JSON", 400, "Request body could not be read.") };
  }

  if (text.trim().length === 0) {
    if (options.allowEmpty) return { ok: true, data: {} };
    return { ok: false, response: errorResponse("INVALID_JSON", 400, "A JSON body is required.") };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse("INVALID_JSON", 400, "Request body must be JSON.") };
  }
}

/* ==========================================================================
   REVIEW QUEUE QUERIES
   ========================================================================== */

/**
 * Both money queues share three states and one paging style, so they share the
 * query parser too. Keeping it in one place is what stops the deposit screen and
 * the payout screen drifting apart on `?status=`, which is the first thing an
 * operator types.
 */
export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type QueueQuery = {
  status?: ReviewStatus;
  userId?: string;
  limit?: number;
  cursor?: string;
};

const queueQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

export type QueueQueryResult =
  | { ok: true; data: QueueQuery }
  | { ok: false; response: NextResponse };

/** Parses `?status=&userId=&limit=&cursor=`. Returns a 400 with field details when any part is invalid. */
export function parseQueueQuery(params: URLSearchParams): QueueQueryResult {
  const parsed = queueQuerySchema.safeParse({
    status: params.get("status") ?? undefined,
    userId: params.get("userId") ?? undefined,
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      response: validationErrorResponse(parsed.error.flatten(), "Invalid query parameters"),
    };
  }

  return { ok: true, data: parsed.data };
}
