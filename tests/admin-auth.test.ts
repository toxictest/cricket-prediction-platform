import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { SignJWT } from "jose";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieName,
  adminCookieOptions,
  signAdminToken,
  verifyAdminToken,
} from "@/lib/admin-session";
import {
  checkAdminPasswordPolicy,
  hashAdminPassword,
  verifyAdminPassword,
} from "@/lib/admin-password";
import { createRateLimiter } from "@/lib/rate-limit";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { GET as me } from "@/app/api/admin/me/route";

/*
 * The cookie store the tests control. Route handlers and requireAdmin read
 * cookies through next/headers, which only works inside a live request.
 */
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
  }),
}));

/*
 * Database-backed cases skip themselves when PostgreSQL is unreachable, the same
 * way the provisioning suite does. The pure cases always run.
 */
const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping admin database tests.\n");
    return false;
  });

const PASSWORD = "correct horse battery staple";
const RUN = `admin-test-${Date.now()}`;
const createdAdminIds: string[] = [];
let PASSWORD_HASH = "";

beforeAll(async () => {
  PASSWORD_HASH = await hashAdminPassword(PASSWORD);
});

afterAll(async () => {
  if (dbAvailable) {
    if (createdAdminIds.length > 0) {
      await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
    }
    await prisma.$disconnect();
  }
});

async function makeAdmin(options: { roles?: Role[]; isActive?: boolean } = {}) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${RUN}-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash: PASSWORD_HASH,
      name: "Test Admin",
      roles: options.roles ?? ["PAYMENT_ADMIN"],
      isActive: options.isActive ?? true,
    },
    select: { id: true, email: true },
  });
  createdAdminIds.push(admin.id);
  return admin;
}

/** A live session row, plus the signed token that points at it. */
async function openSession(
  adminId: string,
  expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000),
) {
  const session = await prisma.adminSession.create({
    data: { id: randomUUID(), adminId, expiresAt },
    select: { id: true, expiresAt: true },
  });
  const token = await signAdminToken({ adminId, ...session });
  return { sessionId: session.id, token };
}

let ipCounter = 0;

function loginRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest("http://localhost:3000/api/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(ipCounter % 250) + 1}`,
      "user-agent": "vitest",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/* ==========================================================================
   PURE: password policy, hashing, tokens, rate limiter
   ========================================================================== */

describe("admin password policy", () => {
  it("rejects passwords shorter than 12 characters", () => {
    expect(checkAdminPasswordPolicy("eleven-char").ok).toBe(false);
  });

  it("accepts a 12-character password", () => {
    expect(checkAdminPasswordPolicy("twelve-chars").ok).toBe(true);
  });

  it("rejects passwords over 72 bytes, which bcrypt would silently truncate", () => {
    // 40 characters, but 80 bytes in UTF-8.
    expect(checkAdminPasswordPolicy("é".repeat(40)).ok).toBe(false);
  });
});

describe("admin password hashing", () => {
  it("stores a bcrypt hash that verifies only the right password", async () => {
    const hash = await hashAdminPassword(PASSWORD);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyAdminPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyAdminPassword("not the password", hash)).toBe(false);
  });

  it("treats a malformed stored hash as a failed check, not an exception", async () => {
    expect(await verifyAdminPassword(PASSWORD, "not-a-bcrypt-hash")).toBe(false);
  });
});

describe("admin session tokens", () => {
  const inOneMinute = () => new Date(Date.now() + 60_000);

  it("round-trips the admin and session ids", async () => {
    const token = await signAdminToken({
      adminId: "adm_1",
      id: "sess_1",
      expiresAt: inOneMinute(),
    });
    expect(await verifyAdminToken(token)).toEqual({
      adminId: "adm_1",
      sessionId: "sess_1",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = await new SignJWT({ sid: "sess_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("adm_1")
      .setIssuer("cpc-admin")
      .setAudience("cpc-admin")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("an-attacker-chosen-secret-of-sufficient-length"));
    expect(await verifyAdminToken(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signAdminToken({
      adminId: "adm_1",
      id: "sess_1",
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await verifyAdminToken(token)).toBeNull();
  });

  it("rejects a token issued for a different audience", async () => {
    const token = await new SignJWT({ sid: "sess_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("adm_1")
      .setIssuer("cpc-admin")
      .setAudience("someone-else")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET ?? ""));
    expect(await verifyAdminToken(token)).toBeNull();
  });

  it("refuses to sign or verify without a usable secret", async () => {
    const original = process.env.ADMIN_SESSION_SECRET;
    try {
      const unusable = [
        undefined,
        "too-short",
        "replace-me-with-openssl-rand-base64-48-plus-padding",
      ];
      for (const value of unusable) {
        if (value === undefined) delete process.env.ADMIN_SESSION_SECRET;
        else process.env.ADMIN_SESSION_SECRET = value;

        await expect(
          signAdminToken({ adminId: "a", id: "s", expiresAt: inOneMinute() }),
        ).rejects.toThrow("ADMIN_SESSION_SECRET");
        await expect(verifyAdminToken("x.y.z")).rejects.toThrow("ADMIN_SESSION_SECRET");
      }
    } finally {
      if (original === undefined) delete process.env.ADMIN_SESSION_SECRET;
      else process.env.ADMIN_SESSION_SECRET = original;
    }
  });
});

describe("admin cookie attributes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a plain name and no Secure flag in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(adminCookieName()).toBe("cpc_admin_session");
    expect(adminCookieOptions(60)).toMatchObject({
      secure: false,
      sameSite: "strict",
      httpOnly: true,
    });
  });

  it("uses the __Host- prefix and Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(adminCookieName()).toBe("__Host-cpc_admin_session");
    expect(adminCookieOptions(0)).toMatchObject({ secure: true, path: "/", maxAge: 0 });
  });
});

/*
 * Enforces the rule that every admin API calls requireAdmin(). Login and logout
 * are the only exceptions, because they establish or end the session. A new
 * admin route that forgets the guard fails this test before it can ship.
 */
describe("admin route coverage", () => {
  const PUBLIC_ADMIN_ROUTES = new Set(["login", "logout"]);

  function listRouteFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return listRouteFiles(path);
      return entry === "route.ts" ? [path] : [];
    });
  }

  it("every admin route except login and logout calls requireAdmin()", () => {
    const adminDir = join(process.cwd(), "src", "app", "api", "admin");
    const routes = listRouteFiles(adminDir);
    expect(routes.length).toBeGreaterThanOrEqual(3);

    for (const file of routes) {
      const segment = relative(adminDir, file).split(/[\\/]/)[0] ?? "";
      if (PUBLIC_ADMIN_ROUTES.has(segment)) continue;

      const source = readFileSync(file, "utf8");
      expect(source, `${relative(process.cwd(), file)} must call requireAdmin()`).toMatch(
        /requireAdmin\(/,
      );
    }
  });
});

describe("rate limiter", () => {
  it("allows the limit, blocks the next attempt, and reopens after the window", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(limiter.hit("k", t0).allowed).toBe(true);
    expect(limiter.hit("k", t0).allowed).toBe(true);
    expect(limiter.hit("k", t0).allowed).toBe(true);
    expect(limiter.hit("k", t0 + 10_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 50,
    });
    expect(limiter.hit("k", t0 + 60_000).allowed).toBe(true);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 0).allowed).toBe(false);
    expect(limiter.hit("b", 0).allowed).toBe(true);
  });
});

/* ==========================================================================
   DATABASE: requireAdmin
   ========================================================================== */

describe.skipIf(!dbAvailable)("requireAdmin", () => {
  beforeEach(() => jar.clear());

  it("returns 401 when there is no session cookie", async () => {
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });

  it("returns 401 and clears the cookie when the token is tampered with", async () => {
    jar.set(adminCookieName(), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.tampered");
    const result = await requireAdmin();
    if (result.ok) throw new Error("expected the request to be rejected");
    expect(result.response.status).toBe(401);
    expect(result.response.cookies.get(adminCookieName())?.maxAge).toBe(0);
  });

  it("admits an active admin with a live session and returns the principal", async () => {
    const admin = await makeAdmin({ roles: ["PAYMENT_ADMIN"] });
    const { token, sessionId } = await openSession(admin.id);
    jar.set(adminCookieName(), token);

    const result = await requireAdmin();
    if (!result.ok) throw new Error("expected the request to be admitted");
    expect(result.admin).toMatchObject({
      id: admin.id,
      email: admin.email,
      roles: ["PAYMENT_ADMIN"],
      sessionId,
    });
  });

  it("returns 403 when the admin holds none of the required roles", async () => {
    const admin = await makeAdmin({ roles: ["PAYMENT_ADMIN"] });
    jar.set(adminCookieName(), (await openSession(admin.id)).token);

    const result = await requireAdmin(["SCORE_ADMIN", "SUPER_ADMIN"]);
    if (result.ok) throw new Error("expected a 403");
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits the admin when at least one of the required roles is held", async () => {
    const admin = await makeAdmin({ roles: ["PAYMENT_ADMIN"] });
    jar.set(adminCookieName(), (await openSession(admin.id)).token);

    const result = await requireAdmin(["SCORE_ADMIN", "PAYMENT_ADMIN"]);
    expect(result.ok).toBe(true);
  });

  it("does not treat SUPER_ADMIN as an implicit pass for other roles", async () => {
    const admin = await makeAdmin({ roles: ["SUPER_ADMIN"] });
    jar.set(adminCookieName(), (await openSession(admin.id)).token);

    const result = await requireAdmin(["PAYMENT_ADMIN"]);
    if (result.ok) throw new Error("SUPER_ADMIN should need the role listed explicitly");
    expect(result.response.status).toBe(403);
  });

  it("admits any active admin when no roles are required, even with an empty role list", async () => {
    const admin = await makeAdmin({ roles: [] });
    jar.set(adminCookieName(), (await openSession(admin.id)).token);

    expect((await requireAdmin()).ok).toBe(true);
  });

  it("applies a role change on the very next request", async () => {
    const admin = await makeAdmin({ roles: ["PAYMENT_ADMIN"] });
    jar.set(adminCookieName(), (await openSession(admin.id)).token);
    expect((await requireAdmin(["PAYMENT_ADMIN"])).ok).toBe(true);

    await prisma.adminUser.update({ where: { id: admin.id }, data: { roles: [] } });

    const result = await requireAdmin(["PAYMENT_ADMIN"]);
    if (result.ok) throw new Error("the role was removed, so access should end");
    expect(result.response.status).toBe(403);
  });

  it("returns 401 once the session has been revoked", async () => {
    const admin = await makeAdmin();
    const { token, sessionId } = await openSession(admin.id);
    jar.set(adminCookieName(), token);
    await prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    const result = await requireAdmin();
    if (result.ok) throw new Error("a revoked session must not be admitted");
    expect(result.response.status).toBe(401);
  });

  it("returns 401 when the session's own expiry has passed, even if the JWT is still valid", async () => {
    const admin = await makeAdmin();
    const session = await prisma.adminSession.create({
      data: {
        id: randomUUID(),
        adminId: admin.id,
        expiresAt: new Date(Date.now() - 1_000),
      },
      select: { id: true },
    });
    // Sign with a future exp, so only the database row can reject the request.
    jar.set(
      adminCookieName(),
      await signAdminToken({
        adminId: admin.id,
        id: session.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const result = await requireAdmin();
    if (result.ok) throw new Error("an expired session must not be admitted");
    expect(result.response.status).toBe(401);
  });

  it("returns 401 when the admin has been deactivated", async () => {
    const admin = await makeAdmin();
    jar.set(adminCookieName(), (await openSession(admin.id)).token);
    await prisma.adminUser.update({ where: { id: admin.id }, data: { isActive: false } });

    const result = await requireAdmin();
    if (result.ok) throw new Error("a deactivated admin must not be admitted");
    expect(result.response.status).toBe(401);
  });

  it("returns 401 when the token names an admin who does not own the session", async () => {
    const owner = await makeAdmin();
    const other = await makeAdmin();
    const { sessionId } = await openSession(owner.id);
    jar.set(
      adminCookieName(),
      await signAdminToken({
        adminId: other.id,
        id: sessionId,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const result = await requireAdmin();
    if (result.ok) throw new Error("a mismatched session must not be admitted");
    expect(result.response.status).toBe(401);
  });
});

/* ==========================================================================
   DATABASE: /api/admin/login, /logout, /me
   ========================================================================== */

describe.skipIf(!dbAvailable)("admin login, logout and me", () => {
  beforeEach(() => jar.clear());

  it("signs in with the right credentials and sets a hardened session cookie", async () => {
    const admin = await makeAdmin({ roles: ["SUPER_ADMIN"] });

    const res = await login(
      loginRequest({ email: admin.email.toUpperCase(), password: PASSWORD }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      data: { admin: { id: admin.id, email: admin.email, roles: ["SUPER_ADMIN"] } },
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${adminCookieName()}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=strict/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it("returns an identical 401 for a wrong password, an unknown email and a deactivated admin", async () => {
    const active = await makeAdmin();
    const inactive = await makeAdmin({ isActive: false });

    const wrongPassword = await login(
      loginRequest({ email: active.email, password: "definitely not it" }),
    );
    const unknownEmail = await login(
      loginRequest({ email: `nobody-${RUN}@example.test`, password: PASSWORD }),
    );
    const deactivated = await login(
      loginRequest({ email: inactive.email, password: PASSWORD }),
    );

    for (const res of [wrongPassword, unknownEmail, deactivated]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
    }

    const [a, b, c] = await Promise.all(
      [wrongPassword, unknownEmail, deactivated].map((res) => res.json()),
    );
    expect(a).toEqual({
      ok: false,
      error: "Invalid email or password.",
      code: "INVALID_CREDENTIALS",
    });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  }, 60_000);

  it("fails closed with a generic 500 when the signing secret is not configured", async () => {
    const original = process.env.ADMIN_SESSION_SECRET;
    const before = await prisma.adminSession.count();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      delete process.env.ADMIN_SESSION_SECRET;
      const admin = await makeAdmin();
      const res = await login(loginRequest({ email: admin.email, password: PASSWORD }));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        ok: false,
        error: "Admin sign-in is not configured.",
        code: "ADMIN_NOT_CONFIGURED",
      });
      // Nothing was written: no session row, and the cookie was not set.
      expect(await prisma.adminSession.count()).toBe(before);
      expect(res.headers.get("set-cookie")).toBeNull();
    } finally {
      consoleError.mockRestore();
      if (original === undefined) delete process.env.ADMIN_SESSION_SECRET;
      else process.env.ADMIN_SESSION_SECRET = original;
    }
  }, 60_000);

  it("refuses form-style content types, which cross-site forms can send without a preflight", async () => {
    const res = await login(
      new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ email: "x@example.test", password: "whatever-you-like" }),
      }),
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("rejects malformed requests before the password is checked", async () => {
    const notJson = await login(loginRequest("{not json"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ code: "INVALID_JSON" });

    const missingPassword = await login(
      loginRequest({ email: "someone@example.test" }),
    );
    expect(missingPassword.status).toBe(400);
    expect(await missingPassword.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throttles repeated attempts against one email, even when the correct password follows", async () => {
    const email = `throttle-${RUN}@example.test`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await login(loginRequest({ email, password: "wrong wrong wrong" }));
      expect(res.status).toBe(401);
    }

    const blocked = await login(loginRequest({ email, password: PASSWORD }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
  }, 60_000);

  it("returns the signed-in admin from /me, and rejects anonymous callers", async () => {
    const anonymous = await me();
    expect(anonymous.status).toBe(401);

    const admin = await makeAdmin({ roles: ["SCORE_ADMIN"] });
    const res = await login(loginRequest({ email: admin.email, password: PASSWORD }));
    jar.set(adminCookieName(), res.cookies.get(adminCookieName())?.value ?? "");

    const current = await me();
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      ok: true,
      data: { admin: { id: admin.id, roles: ["SCORE_ADMIN"] } },
    });
  }, 60_000);

  it("revokes the session on the server, so a copied cookie stops working after logout", async () => {
    const admin = await makeAdmin();
    const res = await login(loginRequest({ email: admin.email, password: PASSWORD }));
    const token = res.cookies.get(adminCookieName())?.value ?? "";
    jar.set(adminCookieName(), token);
    expect((await me()).status).toBe(200);

    const out = await logout();
    expect(out.status).toBe(200);
    expect(out.cookies.get(adminCookieName())?.maxAge).toBe(0);

    // The browser has discarded the cookie. Replay the old token to prove the server rejects it too.
    jar.set(adminCookieName(), token);
    expect((await me()).status).toBe(401);

    const session = await prisma.adminSession.findFirst({ where: { adminId: admin.id } });
    expect(session?.revokedAt).not.toBeNull();
  }, 60_000);

  it("logs out cleanly when there is no cookie", async () => {
    expect((await logout()).status).toBe(200);
  });

  it("locks an admin out on the next request when they are deactivated mid-session", async () => {
    const admin = await makeAdmin();
    const res = await login(loginRequest({ email: admin.email, password: PASSWORD }));
    jar.set(adminCookieName(), res.cookies.get(adminCookieName())?.value ?? "");
    expect((await me()).status).toBe(200);

    await prisma.adminUser.update({ where: { id: admin.id }, data: { isActive: false } });
    expect((await me()).status).toBe(401);
  }, 60_000);
});
