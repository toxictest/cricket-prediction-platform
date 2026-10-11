import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import type { ApiError } from "@/types";
import {
  apiJson,
  apiSuccess,
  errorResponse,
  featureDisabledResponse,
  guardRoute,
  internalErrorResponse,
  logApiError,
  notFoundResponse,
  rateLimitedResponse,
  redactSecrets,
  unauthorizedResponse,
  validationErrorResponse,
} from "@/lib/http";

/* ==========================================================================
   ONE RESPONSE FORMAT, ENFORCED ON THE TREE
   ==========================================================================

   "Every route returns the same envelope" is the kind of statement that stays
   true for about three sprints and then quietly stops being true, because a new
   route was written by copy-pasting the nearest old one. So the rules are
   asserted against the files rather than against a hand-picked list of routes:

     • no route builds a JSON response by hand — `apiJson` / `apiSuccess` /
       `errorResponse` and the domain mappers are the only doors;
     • no route improvises an error body (`{ ok: false, … }` literal in a route
       file), so `error`/`code`/`details` cannot become `message`/`errors`;
     • every handler is wrapped in `guardRoute`, which is what turns "the database
       blinked" into a JSON 500 instead of an HTML page with a stack trace;
     • the wrapped context is the route's own path, because a log line that says
       `unhandled error` without naming the route is not an audit trail.

   A test like this fails for a *new* file too, which is the point.
   ========================================================================== */

const API_ROOT = join(process.cwd(), "src", "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/**
 * `GET /api/auth/[...nextauth]` is NextAuth's own handler. It answers HTML for
 * the sign-in page and JSON for the token endpoints; wrapping or re-typing it is
 * how a Google sign-in regression gets introduced. Everything else is ours.
 */
const EXEMPT = new Set(["auth/[...nextauth]/route.ts"]);

function routeFiles(dir: string = API_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (entry === "route.ts") found.push(relative(API_ROOT, full));
  }
  return found.sort();
}

const ROUTES = routeFiles();
const GUARDED = ROUTES.filter((route) => !EXEMPT.has(route));

describe("every route is wrapped and uses the helpers", () => {
  it("finds the routes (a vacuous glob is a failed test, not a pass)", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(29);
    expect(ROUTES).toContain(join("wallet", "route.ts"));
    expect(ROUTES).toContain(join("admin", "payments", "[id]", "approve", "route.ts"));
  });

  it.each(GUARDED)("%s wraps each exported method in guardRoute with its own path", (route) => {
    const source = readFileSync(join(API_ROOT, route), "utf8");
    const exported = METHODS.filter((method) =>
      new RegExp(`^export (async function ${method}\\(|const ${method} =)`, "m").test(source),
    );
    expect(exported.length, route).toBeGreaterThan(0);

    const context = "api/" + relative(API_ROOT, join(API_ROOT, route)).replace(/[/\\]route\.ts$/, "");
    for (const method of exported) {
      expect(source, `${route} ${method}`).toContain(`guardRoute("${context}", handle${method})`);
    }
    // The unwrapped form is the thing we are removing; it must not come back.
    expect(source).not.toMatch(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/m);
  });

  it.each(GUARDED)("%s builds no response and no error body by hand", (route) => {
    const source = readFileSync(join(API_ROOT, route), "utf8");
    expect(source, route).not.toMatch(/NextResponse\.json\s*\(/);
    expect(source, route).not.toMatch(/ok:\s*false/);
    // `NextResponse` may still appear for a redirect or a streamed file, and only there.
    for (const line of source.split("\n")) {
      if (line.includes("NextResponse.") && !/NextResponse\.(redirect|rewrite)/.test(line)) {
        expect.fail(`${route}: unexpected NextResponse use -> ${line.trim()}`);
      }
    }
  });

  it.each(GUARDED)("%s says what a client must do with a 405", (route) => {
    // Not every route needs this — Next answers 405 on its own for undefined
    // methods — but where a route *does* define one to reject it, the response
    // has to name the allowed methods so a client can fix the call.
    const source = readFileSync(join(API_ROOT, route), "utf8");
    const explicit = /async function handle(HEAD|OPTIONS)\(|Method not allowed/.test(source);
    if (explicit) expect(source, route).toMatch(/Allow/);
  });
});

describe("the envelope helpers", () => {
  async function bodyOf(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  it("wraps a success as { ok: true, data } and never caches it", async () => {
    const response = apiSuccess({ a: 1 });
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ ok: true, data: { a: 1 } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets a route widen the envelope but not lose no-store", async () => {
    const response = apiJson({ ok: true, data: {} }, 200, { "Cache-Control": "no-store, max-age=0", ETag: "x" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("etag")).toBe("x");
  });

  it("gives every error the same three keys, with details only when there are any", async () => {
    const bare = await bodyOf(errorResponse("NOT_FOUND", 404, "Gone"));
    expect(Object.keys(bare).sort()).toEqual(["code", "error", "ok"]);

    const detailed = await bodyOf(validationErrorResponse({ fieldErrors: { amount: ["too big"] } }, "Invalid"));
    expect(detailed).toEqual({
      ok: false,
      error: "Invalid",
      code: "VALIDATION_ERROR",
      details: { fieldErrors: { amount: ["too big"] } },
    });
  });

  it("answers 401 and 429 with the wording every client already branches on", async () => {
    expect(await bodyOf(unauthorizedResponse())).toEqual({
      ok: false,
      error: "Not authenticated",
      code: "UNAUTHORIZED",
    });

    const limited = rateLimitedResponse("Slow down", 45);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("45");

    // A zero-second Retry-After invites a retry loop, so it is floored at 1.
    expect(rateLimitedResponse("Slow down", 0).headers.get("retry-after")).toBe("1");
  });

  it("keeps a feature gate at 503 with a long Retry-After", async () => {
    const response = featureDisabledResponse("Money is off", "PAYMENTS_DISABLED");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(await bodyOf(response)).toMatchObject({ code: "PAYMENTS_DISABLED" });
  });

  it("404s a missing thing, not a missing route", async () => {
    const response = notFoundResponse("No such payout");
    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({ ok: false, error: "No such payout", code: "NOT_FOUND" });
  });
});

describe("guardRoute", () => {
  /**
   * Spied per test, not at collection: Vitest installs its own console
   * interception when a test starts, and a spy taken before that is quietly
   * replaced — the assertion would then be looking at a function nobody calls.
   */
  function spyOnErrors() {
    return vi.spyOn(console, "error").mockImplementation(() => {});
  }
  afterEach(() => vi.restoreAllMocks());

  it("passes a good response straight through, untouched", async () => {
    const logs = spyOnErrors();
    const handler = guardRoute("api/test", async () => apiSuccess({ hello: "world" }));
    const response = await handler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { hello: "world" } });
    expect(logs).not.toHaveBeenCalled();
  });

  it("turns a throw into the same envelope, with a generic message", async () => {
    const logs = spyOnErrors();
    const handler = guardRoute("api/test", async () => {
      throw new Error(
        "Invalid `prisma.wallet.findUnique()` invocation: Can't reach database server at postgresql://cricket:pw@10.0.0.7:5432/db",
      );
    });

    const response = await handler();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as ApiError & { details?: unknown };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).toBe("Something went wrong on our side. The details were logged.");

    // Production must not say anything about the failure, in any field.
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(/prisma|sql|postgresql|cricket:pw|10\.0\.0\.7|invocation/i);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0][0]).toContain("[api/test] unhandled error:");
  });

  it("catches a throw from a synchronous handler too", async () => {
    const handler = guardRoute("api/test", () => {
      throw new Error("boom");
    });
    expect((await handler()).status).toBe(500);
  });

  it("keeps a Response the handler returned as-is, including a redirect", async () => {
    const handler = guardRoute("api/test", () => Response.redirect("https://cdn.example.test/app.apk", 307));
    const response = await handler();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cdn.example.test/app.apk");
  });

  it("does not launder an error the handler already mapped", async () => {
    // The wrapper only fires when nothing else answered. A 422 from the wallet
    // rules must reach the client exactly as the domain mapper built it.
    const handler = guardRoute("api/test", async () =>
      errorResponse("MINIMUM_BALANCE" as ApiError["code"], 422, "Minimum 100 tokens must remain in wallet"),
    );
    const response = await handler();
    expect(response.status).toBe(422);
    expect(((await response.json()) as ApiError).code).toBe("MINIMUM_BALANCE");
  });
});

describe("internalErrorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the detail in development and hides it in production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = (await internalErrorResponse(new Error("raw sql text"), "api/x").json()) as ApiError;
    expect(dev.details).toEqual({ detail: "Error: raw sql text" });

    vi.stubEnv("NODE_ENV", "production");
    const prod = (await internalErrorResponse(new Error("raw sql text"), "api/x").json()) as ApiError;
    expect("details" in prod).toBe(false);
    expect(JSON.stringify(prod)).not.toContain("raw sql text");
    vi.unstubAllEnvs();
  });

  it("survives a thrown non-Error", async () => {
    const response = await internalErrorResponse("just a string", "api/x").json();
    expect(response).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });
});

describe("every 500 the API produces is logged, and logged redacted", () => {
  /**
   * `guardRoute` only sees an error if a handler lets it escape, and no handler does:
   * each one catches and hands the error to its domain mapper. So the mapper's
   * fallback branch is where a 500 is born, and it is also the last place the error
   * still exists. A mapper that returns 500 without logging here leaves the operator
   * with a status code and nothing to read.
   */
  const MAPPERS = ["wallet-http.ts", "payment-http.ts", "withdrawal-http.ts", "match-http.ts"];

  it.each(MAPPERS)("%s logs its fallback through the shared logger", (file) => {
    const source = readFileSync(join(process.cwd(), "src", "lib", file), "utf8");
    expect(source, file).toMatch(/logApiError\("[a-z]+", error\)/);
    // Not `console.error(…, error)`: printing the object prints whatever it is
    // carrying — a DSN, a signed URL — with nothing redacting it first.
    expect(source, file).not.toMatch(/console\.error\(/);
  });

  it("redacts a secret before it reaches the log, stack included", () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error('connect failed password=hunter2secret to postgresql://u:sup3rs3cret@db/prod');
      error.stack = "Error: connect failed\n at Object.<anonymous> (/app/src/lib/db.ts:12:3)";
      logApiError("api/example", error);

      const line = String(logs.mock.calls[0]?.[0] ?? "");
      expect(line).toContain("[api/example] unhandled error:");
      expect(line).toContain("Error: connect failed");
      expect(line).toContain("/app/src/lib/db.ts:12:3"); // the useful part survives
      expect(line).not.toContain("hunter2secret");
      expect(line).not.toContain("sup3rs3cret");
    } finally {
      logs.mockRestore();
    }
  });
});

describe("redactSecrets", () => {
  it("removes credentials from a connection string", () => {
    const out = redactSecrets("connect failed postgresql://user:sup3rs3cret@db.internal:5432/prod");
    expect(out).not.toContain("sup3rs3cret");
    expect(out).toContain("db.internal:5432/prod"); // the host is still useful in a log
  });

  it("removes key=value secrets and JWTs", () => {
    expect(redactSecrets("password=hunter2 other=keep")).not.toContain("hunter2");
    expect(redactSecrets('{"token": "abc"}')).not.toContain("abc");
    // The real shape, from an admin session token this repo minted during a live check.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbXYzZjd5b2EwMDAwbnpyY3djYzRtbHpqIn0.jrsrM0u4FQr53OgPlKZUHVd7FX7";
    expect(redactSecrets(`Bearer ${jwt}`)).not.toContain("signaturevalue");
  });

  it("leaves an ordinary message alone", () => {
    const plain = "Validation error: amount must be a whole number from 1 to 10000000";
    expect(redactSecrets(plain)).toBe(plain);
  });
});

describe("the code vocabulary is closed", () => {
  /**
   * The base union in `src/types` is the whole set a route may invent. Domain
   * codes (WALLET_NOT_FOUND, SCORE_STALE, …) belong to their service's union and
   * are only allowed to reach the wire through that service's mapper — which is
   * why a `code: "…"` literal in a route file has to be one of these.
   */
  const ROUTE_CODES = new Set([
    "VALIDATION_ERROR",
    "INVALID_JSON",
    "UNSUPPORTED_MEDIA_TYPE",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "FORBIDDEN",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "BUILD_UNAVAILABLE",
    "PAYMENTS_DISABLED",
    "NO_ACTIVE_QR",
    // staff-side codes, all declared on AdminApiError
    "UNAUTHENTICATED",
    "INVALID_CREDENTIALS",
    "ADMIN_NOT_CONFIGURED",
  ]);

  it("never invents a code in a route file", () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      const source = readFileSync(join(API_ROOT, route), "utf8");
      for (const match of source.matchAll(/code:\s*"([A-Z_]+)"/g)) {
        if (!ROUTE_CODES.has(match[1] as string)) offenders.push(`${route}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the base union and this list in step", () => {
    const types = readFileSync(join(process.cwd(), "src", "types", "index.ts"), "utf8");
    const declared = new Set(
      [...types.matchAll(/^\s+\| "([A-Z_]+)"/gm)].map((match) => match[1] as string),
    );
    for (const code of [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "UNSUPPORTED_MEDIA_TYPE",
      "INVALID_JSON",
      "PAYMENTS_DISABLED",
      "NO_ACTIVE_QR",
      "BUILD_UNAVAILABLE",
    ]) {
      expect(declared.has(code), code).toBe(true);
    }
    // The staff codes live on AdminApiError, not in the base union.
    const guard = readFileSync(join(process.cwd(), "src", "lib", "admin-guard.ts"), "utf8");
    for (const code of ["UNAUTHENTICATED", "INVALID_CREDENTIALS", "ADMIN_NOT_CONFIGURED"]) {
      expect(guard).toContain(`"${code}"`);
    }
  });
});
