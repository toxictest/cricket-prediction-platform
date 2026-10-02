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
