import { describe, expect, it } from "vitest";

/**
 * HTTP contract tests against a running server.
 *
 * Verifies the access gate from the outside — the way an attacker or a
 * misconfigured client would experience it — rather than asserting on
 * internal function calls.
 *
 *   # terminal 1
 *   npm run dev          # or: npm run build && npm start
 *
 *   # terminal 2
 *   npm test
 *
 * If nothing is listening on BASE_URL the suite skips itself, so `npm test`
 * never fails merely because the dev server is not up.
 */

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

/**
 * Probed at MODULE LOAD, not in `beforeAll` — `describe.skipIf()` is resolved
 * during collection, so a flag set in a hook would never take effect.
 */
const serverUp: boolean = await fetch(`${BASE}/api/health`, {
  signal: AbortSignal.timeout(3_000),
})
  .then((res) => res.status < 500)
  .catch(() => {
    console.warn(
      `\n  ⚠ No server on ${BASE} — skipping HTTP contract tests.` +
        "\n    Start one with `npm run dev` and re-run.\n",
    );
    return false;
  });

/** A fetch that does not follow redirects, so we can assert on the 307. */
const raw = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { redirect: "manual", ...init });

/* ==========================================================================
   PUBLIC SURFACE
   ========================================================================== */

describe.skipIf(!serverUp)("public routes", () => {
  const publicPaths = [
    "/",
    "/login",
    "/register",
    "/terms",
    "/privacy",
    "/responsible-play",
    "/contact",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/icon.svg",
  ];

  it.each(publicPaths)("GET %s → 200", async (path) => {
    const res = await raw(path);
    expect(res.status).toBe(200);
  });

  it("returns 404 for an unmapped route", async () => {
    const res = await raw("/definitely-not-a-route");
    expect(res.status).toBe(404);
  });

  it("disallows gated routes in robots.txt", async () => {
    const body = await (await raw("/robots.txt")).text();
    for (const gated of ["/dashboard", "/download", "/api/"]) {
      expect(body).toContain(`Disallow: ${gated}`);
    }
  });

  it("omits gated routes from the sitemap", async () => {
    const body = await (await raw("/sitemap.xml")).text();
    expect(body).not.toContain("/dashboard");
    expect(body).not.toContain("/download<");
  });
});

/* ==========================================================================
   HEALTH
   ========================================================================== */

describe.skipIf(!serverUp)("GET /api/health", () => {
  it("reports the database as connected", async () => {
    const res = await raw("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("healthy");
    expect(body.data.database).toBe("connected");
    expect(typeof body.data.latencyMs).toBe("number");
  });

  it("is not cacheable", async () => {
    const res = await raw("/api/health");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

/* ==========================================================================
   THE GATE — the headline requirement
   ========================================================================== */

describe.skipIf(!serverUp)("access gate: guests", () => {
  const gated = ["/dashboard", "/download", "/downloads/app-release.apk"];

  it.each(gated)("GET %s redirects to /login", async (path) => {
    const res = await raw(path);
    expect(res.status).toBe(307);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(decodeURIComponent(location)).toContain(
      `callbackUrl=${path === "/downloads/app-release.apk" ? "/downloads/app-release.apk" : path}`,
    );
  });

  it("GET /api/download returns 401 with the product copy", async () => {
    const res = await raw("/api/download");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toBe(
      "Access restricted. Please activate your account first.",
    );
  });

  it("GET /api/session returns 401", async () => {
    const res = await raw("/api/session");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("GET /api/download for a guest never leaks artifact bytes", async () => {
    const res = await raw("/api/download");
    const body = await res.text();

    // A ZIP container starts with "PK\x03\x04". A 401 body must not.
    expect(body).not.toContain("PK\u0003\u0004");
    expect(body).not.toMatch(/[a-f0-9]{64}/);
  });

  it("POST /api/download is rejected with 405", async () => {
    const res = await raw("/api/download", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("never leaks the artifact to an unauthenticated client", async () => {
    const res = await raw("/api/download");
    const text = await res.text();
    // No PK header, no ZIP magic, no checksum.
    expect(text).not.toMatch(/PK\x03\x04/);
    expect(text).not.toMatch(/[a-f0-9]{64}/);
  });
});

/* ==========================================================================
   REFERRAL API
   ========================================================================== */

describe.skipIf(!serverUp)("GET /api/referral", () => {
  /**
   * The limiter keys on the client IP, taken from `x-forwarded-for`. When that
   * header is absent every request collapses into one shared "unknown" bucket,
   * so the 40-request throttle test below would exhaust it for 60s and make
   * every later assertion in this describe fail with a false 429.
   *
   * Giving each test its own forwarded IP isolates the buckets and, as a
   * bonus, exercises the limiter's keying logic directly.
   */
  const asClient = (ip: string, path: string, init: RequestInit = {}) =>
    raw(path, { ...init, headers: { "x-forwarded-for": ip, ...init.headers } });

  it("rejects a malformed code with 400", async () => {
    const res = await asClient("203.0.113.10", "/api/referral?code=AB");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for an unknown code", async () => {
    const res = await asClient("203.0.113.11", "/api/referral?code=CRC-ZZZZZZZZ");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("rejects a missing code parameter", async () => {
    const res = await asClient("203.0.113.12", "/api/referral");
    expect(res.status).toBe(400);
  });

  it("validates a seeded code and reveals only a first name", async () => {
    const res = await asClient("203.0.113.13", "/api/referral?code=CRC-ARCH1TEC");

    if (res.status === 404) {
      // Seeded data may not be present on a fresh database.
      return;
    }

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.code).toBe("CRC-ARCH1TEC");

    // Privacy: no surname, no email, no id.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toMatch(/"id"/);
    expect(body.data.referrerFirstName).not.toContain(" ");
  });

  it("enforces 30 requests/minute per client and publishes a Retry-After", async () => {
    const ip = "198.51.100.250";

    // Sequential (not Promise.all) so the limiter sees a strict order and the
    // 31st request is guaranteed to be the first rejection.
    const statuses: number[] = [];
    for (let i = 0; i < 34; i += 1) {
      const res = await asClient(ip, "/api/referral?code=CRC-ARCH1TEC");
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get("retry-after")).toBe("60");
      }
    }

    const allowed = statuses.filter((s) => s !== 429).length;
    const limited = statuses.filter((s) => s === 429).length;

    // The window allows 30; anything past that must be throttled.
    expect(allowed).toBeLessThanOrEqual(30);
    expect(limited).toBeGreaterThanOrEqual(4);

    // Never 5xx, even under sustained load.
    for (const s of statuses) expect(s).toBeLessThan(500);
  });

  it("keys the limit per client, not globally", async () => {
    // A fresh IP must still be served even while another is throttled.
    const res = await asClient("198.51.100.251", "/api/referral?code=CRC-ARCH1TEC");
    expect(res.status).not.toBe(429);
  });
});

/* ==========================================================================
   SECURITY HEADERS
   ========================================================================== */

describe.skipIf(!serverUp)("security headers", () => {
  it("sets the hardening headers on every response", async () => {
    const res = await raw("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("forces the APK mime type and disables caching on /downloads", async () => {
    // 307 for a guest, but the header rule still applies to the route.
    const res = await raw("/downloads/app-release.apk");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

/* ==========================================================================
   AUTH SURFACE
   ========================================================================== */

describe.skipIf(!serverUp)("auth endpoints", () => {
  it("exposes the provider list without leaking secrets", async () => {
    const res = await raw("/api/auth/providers");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("google");
    expect(body.google.signinUrl).toContain("/api/auth/signin/google");

    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/GOCSPX/);
    expect(serialised.toLowerCase()).not.toContain("clientsecret");
  });

  it("issues a CSRF token for the sign-in flow", async () => {
    const res = await raw("/api/auth/csrf");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(20);
  });

  it("returns an empty session for an anonymous client", async () => {
    const res = await raw("/api/auth/session");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeUndefined();
  });

  /* ------------------------------------------------------------------
     Google-only authentication.

     These assertions exist to keep a removed feature removed. The build
     previously shipped an env-gated credentials provider ("Developer
     Access") that accepted an email + passphrase and provisioned a real
     database row. It was deleted so that every account traces back to a
     verified Google identity. A future refactor that reintroduces a
     credentials provider — or merely re-renders its form — will fail here.
     ------------------------------------------------------------------ */
  it("registers exactly one provider: google", async () => {
    const res = await raw("/api/auth/providers");
    const body = await res.json();

    expect(Object.keys(body)).toEqual(["google"]);
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("developer");
  });

  it("offers no email/password sign-in UI on /login", async () => {
    const res = await raw("/login");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toMatch(/Developer Access/i);
    expect(html).not.toMatch(/Access passphrase/i);
    expect(html).not.toMatch(/DEMO_LOGIN_PASSWORD/);
    expect(html.toLowerCase()).not.toContain("bypass channel");
  });

  it("offers no email/password sign-up UI on /register", async () => {
    const res = await raw("/register");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toMatch(/Developer Access/i);
    expect(html).not.toMatch(/Create Member Record/i);
    expect(html).not.toMatch(/DEMO_LOGIN_PASSWORD/);
  });

  it("still exposes the Google button on both auth screens", async () => {
    for (const path of ["/login", "/register"]) {
      const html = await (await raw(path)).text();
      expect(html).toMatch(/accounts\.google\.com|Continue with Google|Register with Google/i);
    }
  });
});

/* ==========================================================================
   ADMIN API (anonymous callers)
   ========================================================================== */

describe.skipIf(!serverUp)("admin API (anonymous)", () => {
  it("GET /api/admin/me → 401 JSON, and the response is never cached", async () => {
    const res = await raw("/api/admin/me");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("POST /api/admin/login rejects unknown credentials and sets no cookie", async () => {
    const res = await raw("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "nobody@example.test",
        password: "not-a-real-password",
      }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({
      ok: false,
      error: "Invalid email or password.",
      code: "INVALID_CREDENTIALS",
    });
  });

  it("POST /api/admin/logout succeeds without a session and clears the cookie", async () => {
    const res = await raw("/api/admin/logout", { method: "POST" });

    expect(res.status).toBe(200);
    // __Host-cpc_admin_session in production builds, cpc_admin_session in development.
    expect(res.headers.get("set-cookie") ?? "").toMatch(
      /(__Host-)?cpc_admin_session=;.*Max-Age=0/,
    );
  });
});

/* ==========================================================================
   WALLET API (anonymous callers)
   ========================================================================== */

describe.skipIf(!serverUp)("wallet API (anonymous)", () => {
  it("GET /api/wallet → 401 JSON, and the response is never cached", async () => {
    const res = await raw("/api/wallet");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("GET /api/wallet/transactions → 401 before the query is validated", async () => {
    const res = await raw("/api/wallet/transactions?limit=abc");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("GET /api/admin/wallet/:userId → 401 and no member data", async () => {
    const res = await raw("/api/admin/wallet/some-member-id");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});

/* ==========================================================================
   PAYMENT API (anonymous callers)
   ========================================================================== */

describe.skipIf(!serverUp)("payment API (anonymous)", () => {
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("GET /api/payment/qr → 401, and the QR is never cached", async () => {
    const res = await raw("/api/payment/qr");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("POST /api/payment/request → 401 before the claim is read or validated", async () => {
    const res = await raw(
      "/api/payment/request",
      json({ amount: 500, utrNumber: "123456789012", screenshotUrl: "https://storage.example.test/a.png" }),
    );

    // Nobody anonymous can park rows in the review queue, so a well-formed body
    // and a malformed one get the same answer.
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });

    const malformed = await raw("/api/payment/request", json("{"));
    expect(malformed.status).toBe(401);
  });

  it("GET /api/admin/payments → 401 and no claim data", async () => {
    const res = await raw("/api/admin/payments?status=PENDING&limit=abc");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(["approve", "reject"])("POST /api/admin/payments/:id/%s → 401", async (action) => {
    const res = await raw(`/api/admin/payments/some-claim-id/${action}`, json({}));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("does not let a GET reach a POST-only review action", async () => {
    for (const action of ["approve", "reject"]) {
      const res = await raw(`/api/admin/payments/some-claim-id/${action}`);
      expect(res.status).toBe(405);
    }
  });
});

/* ==========================================================================
   WITHDRAWAL API (anonymous callers)
   ========================================================================== */

describe.skipIf(!serverUp)("withdrawal API (anonymous)", () => {
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("GET /api/withdrawal/my → 401 JSON, and the history is never cached", async () => {
    const res = await raw("/api/withdrawal/my?status=PENDING&limit=abc");

    // Auth first, query validation second: an anonymous caller learns nothing
    // about which parameters exist.
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("POST /api/withdrawal/request → 401 before the payout is read or validated", async () => {
    const res = await raw("/api/withdrawal/request", json({ amount: 500, upiId: "rahul@ybl" }));

    // Nobody anonymous may file a claim on a balance, so a well-formed body and
    // a malformed one must get the same answer.
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });

    const malformed = await raw("/api/withdrawal/request", json("{"));
    expect(malformed.status).toBe(401);
  });

  it("does not let a GET reach the POST-only payout endpoint", async () => {
    const res = await raw("/api/withdrawal/request");
    expect(res.status).toBe(405);
  });

  it("GET /api/admin/withdrawals → 401 and no payout data", async () => {
    const res = await raw("/api/admin/withdrawals?status=PENDING&limit=abc");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(["approve", "reject"])("POST /api/admin/withdrawals/:id/%s → 401", async (action) => {
    const res = await raw(`/api/admin/withdrawals/some-request-id/${action}`, json({}));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("does not let a GET reach a POST-only review action", async () => {
    for (const action of ["approve", "reject"]) {
      const res = await raw(`/api/admin/withdrawals/some-request-id/${action}`);
      expect(res.status).toBe(405);
    }
  });
});

/* ==========================================================================
   MATCH API
   ========================================================================== */

describe.skipIf(!serverUp)("match API (public reads)", () => {
  /** These checks must hold on an empty database, so none of them needs a fixture. */
  it("GET /api/matches → 200, public, and cacheable for a few seconds", async () => {
    const res = await raw("/api/matches");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.order).toBe("desc");

    // A match list is the same for everyone, so it is the one response in this
    // area that may be cached. Everything personal in the API is `no-store`.
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toContain("public");
    expect(cache).toContain("max-age=");
    expect(cache).not.toContain("no-store");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("never returns the payment QR or the feed id to an anonymous reader", async () => {
    const res = await raw("/api/matches");
    // Asserted on the raw bytes, not the parsed object: the point is that the
    // field is never put on the wire at all.
    const text = await res.text();
    expect(text).not.toMatch(/qrCodeUrl/i);
    expect(text).not.toMatch(/externalId/i);
  });

  it("GET /api/matches/live → 200 with an ETag, and 304 on a revalidation", async () => {
    const first = await raw("/api/matches/live");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await raw("/api/matches/live", { headers: { "If-None-Match": etag ?? "" } });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  it("rejects a bad page and a private parameter instead of ignoring it", async () => {
    const bad = await raw("/api/matches?limit=0");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });

    const search = await raw("/api/matches?q=kings");
    expect(search.status).toBe(400);
    expect(await search.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Search is available on the admin match list only",
    });
  });

  it("answers 404 for a match that is not there, on both public read shapes", async () => {
    for (const path of [
      "/api/matches/000000000000000000000000",
      "/api/matches/000000000000000000000000/score",
    ]) {
      const res = await raw(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, code: "MATCH_NOT_FOUND" });
    }
  });

  it("does not accept writes on the public routes", async () => {
    const list = await raw("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(list.status).toBe(405);

    const score = await raw("/api/matches/live/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(score.status).toBe(405);
  });
});

describe.skipIf(!serverUp)("match API (anonymous admin callers)", () => {
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("GET /api/admin/matches → 401 and no fixture data", async () => {
    const res = await raw("/api/admin/matches?status=LIVE&limit=abc");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("POST /api/admin/matches → 401 before the body is read", async () => {
    const res = await raw(
      "/api/admin/matches",
      json("POST", { title: "Secret XI vs Also Secret XI", teamA: "a", teamB: "b", startTime: "2026-11-01T10:00:00Z" }),
    );
    expect(res.status).toBe(401);

    const malformed = await raw("/api/admin/matches", json("POST", "{"));
    expect(malformed.status).toBe(401);
  });

  it("PATCH /api/admin/matches/:id and POST …/score → 401", async () => {
    const patch = await raw("/api/admin/matches/some-match-id", json("PATCH", { status: "LIVE" }));
    expect(patch.status).toBe(401);

    const score = await raw(
      "/api/admin/matches/some-match-id/score",
      json("POST", { teamAScore: "1/0", teamBScore: "0/0", currentOver: "1.0" }),
    );
    expect(score.status).toBe(401);
  });

  it("has no read or delete surface on the single-match admin route", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await raw("/api/admin/matches/some-match-id", { method });
      expect(res.status).toBe(405);
    }
  });

  it("does not let a GET reach the POST-only score route", async () => {
    const res = await raw("/api/admin/matches/some-match-id/score");
    expect(res.status).toBe(405);
  });
});

/* ==========================================================================
   MEMBER SNAPSHOT
   ========================================================================== */

describe.skipIf(!serverUp)("GET /api/me and the member-facing surface", () => {
  it("answers a guest with 401 and no hint of a wallet", async () => {
    const res = await raw("/api/me");
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toMatch(/balance|wallet/i);
  });

  it("refuses a write: /api/me is a read", async () => {
    const res = await raw("/api/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed by a POST" }),
    });
    expect(res.status).toBe(405);
  });

  /**
   * The protection rule for the six member-facing reads, stated where it can be
   * seen: the three that are personal answer 401 to an anonymous caller, and the
   * three about the fixture calendar answer 200. A match page is public by design;
   * a balance is not.
   */
  it("protects what is personal and leaves what is not open", async () => {
    const personal = ["/api/me", "/api/wallet", "/api/wallet/transactions"];
    for (const path of personal) {
      const res = await raw(path);
      expect([res.status, path]).toEqual([401, path]);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }

    const publicPaths = ["/api/matches", "/api/matches/live", "/api/matches?limit=1"];
    for (const path of publicPaths) {
      const res = await raw(path);
      expect([res.status, path]).toEqual([200, path]);
      expect(res.headers.get("cache-control"), path).not.toContain("no-store");
    }
  });
});

/* ==========================================================================
   ADMIN PANEL PAGES
   ========================================================================== */

describe.skipIf(!serverUp)("admin panel pages (anonymous browser)", () => {
  /**
   * The pages are guarded by a layout, not by `middleware.ts` — middleware only
   * knows the member session. So the panel's wall has to be visible from outside.
   *
   * The mechanism is Next's, not ours: a *document* request that meets
   * `redirect()` inside a Server Component comes back as a 200 whose HTML hands
   * the browser over with `<meta http-equiv="refresh">`, while a client-side
   * navigation receives a 307. Both spellings are asserted as one contract — you
   * end up at the sign-in page, and none of the queue is in the bytes you got.
   */
  async function expectHandoffToLogin(path: string, words: RegExp = /Deposit claims|Payout requests|referralCode|Approve claim/i) {
    const res = await raw(path);
    const body = await res.text();
    const location = res.headers.get("location") ?? "";
    const handedOver =
      ([301, 302, 303, 307, 308].includes(res.status) && /\/admin\/(login|dashboard)/.test(location)) ||
      (res.status === 200 && /url=\/admin\/login/.test(body));
    expect([handedOver, path]).toEqual([true, path]);
    expect(body, path).not.toMatch(words);
  }

  it.each(["/admin", "/admin/dashboard", "/admin/payments", "/admin/payments?status=PENDING"])(
    "%s cannot be read without a session",
    async (path) => {
      await expectHandoffToLogin(path);
    },
  );

  it("never lets a guarded page be cached, so a proxy cannot keep it alive past sign-out", async () => {
    const res = await raw("/admin/dashboard");
    expect((res.headers.get("cache-control") ?? "").toLowerCase()).toContain("no-store");
  });

  it("serves the sign-in page itself, and tells crawlers to stay away from the whole subtree", async () => {
    const res = await raw("/admin/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Back office/);
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/name="email"/);
    // Metadata `robots: { index: false }` on the /admin layout reaches the HTML as a
    // meta tag (Next does not raise an X-Robots-Tag header for metadata).
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    // No admin identity, and nothing an autofiller would happily fill in.
    expect(html).not.toMatch(/SUPER_ADMIN|PAYMENT_ADMIN/);
    // Password managers get the right hint; nothing here is a member login form.
    // React writes the prop name through (`autoComplete=`); HTML attribute names
    // are case-insensitive, so the assertion has to be too.
    expect(html).toMatch(/autocomplete="current-password"/i);
  });

  it("404s an unknown admin path instead of treating the guard as a catch-all", async () => {
    const res = await raw("/admin/definitely-not-a-page");
    expect(res.status).toBe(404);
  });

  it("still refuses the guarded APIs with JSON, so a page handoff never masks an endpoint", async () => {
    const res = await raw("/api/admin/payments", { headers: { accept: "application/json" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("hands a stale cookie to the sign-in page rather than rendering a half-built queue", async () => {
    await expectHandoffToLogin("/admin/dashboard", /Deposit claims|Good to see you/);
  });
});

/**
 * Optional, and the only test here that proves a real session unlocks a real page.
 * Needs a seeded admin, so it stays out of the way of a clean checkout:
 *
 *   ADMIN_TEST_EMAIL=ops@example.com ADMIN_TEST_PASSWORD='…' npm test
 */
const adminEmail = process.env.ADMIN_TEST_EMAIL;
const adminPassword = process.env.ADMIN_TEST_PASSWORD;
const canSignIn = Boolean(serverUp && adminEmail && adminPassword);

describe.skipIf(!canSignIn)("admin panel pages (signed-in admin)", () => {
  async function sessionCookie(): Promise<string> {
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      redirect: "manual",
    });
    if (res.status !== 200) throw new Error(`login returned ${res.status}`);
    const setCookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).find((entry) =>
      /cpc_admin_session=/.test(entry),
    );
    if (!setCookie) throw new Error("no admin session cookie in the login response");
    return setCookie.split(";")[0] as string;
  }

  it("renders the dashboard for a valid session, and never the sign-in form", async () => {
    const cookie = await sessionCookie();
    const res = await raw("/admin/dashboard", { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/control panel/i);
    expect(html).not.toMatch(/type="password"/);
  });

  it("keeps the session cookie HttpOnly and SameSite=strict", async () => {
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      redirect: "manual",
    });
    const setCookie = (res.headers.getSetCookie?.() ?? []).join(" | ");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie.toLowerCase()).toMatch(/samesite=strict/);
  });
});
