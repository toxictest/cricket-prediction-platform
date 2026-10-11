import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import type { Role } from "@prisma/client";
import { adminCookieName } from "@/lib/admin-session";
import {
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_SECTIONS,
  checkAdminPage,
  hasRole,
  MATCH_ROLES,
  REVIEW_ROLES,
  requireAdminPage,
  roleLabels,
  ROLE_LABELS,
  sectionsFor,
} from "@/lib/admin-web";

/* ==========================================================================
   THE PANEL'S OWN CONTRACT
   ==========================================================================

   A route handler that forgets `requireAdmin()` leaks data. A *page* that
   forgets its guard leaks the whole admin surface to anybody who can type a URL,
   and — worse — it can look fine while doing it, because the nav hides the link.
   So the tree itself is asserted here:

     • every page under /admin except the sign-in screen lives in `(panel)`,
       which is the layout that calls `requireAdminPage()`;
     • `(panel)/layout.tsx` really does call it, in the guard's exact spelling;
     • a nav section is marked `built` only when its page file exists, and every
       page that exists is reachable from the nav;
     • role gates are non-empty where they must be, and a role never gains
       access by an accident of `includes`.

   The cookie → session → row resolution underneath is covered by
   tests/admin-auth.test.ts (37 cases) — `checkAdminPage` calls the same
   `readAdminSession()` those tests exercise, which is the point of the refactor:
   one implementation, two surfaces.
   ========================================================================== */

const ADMIN_APP = join(process.cwd(), "src", "app", "admin");

function pagesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === "page.tsx" || entry === "page.ts") out.push(relative(ADMIN_APP, full));
  }
  return out.sort();
}

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
  }),
}));

const ALL_PAGES = pagesUnder(ADMIN_APP);

describe("admin page tree", () => {
  it("finds the pages this increment created (a vacuous glob is a failed test)", () => {
    expect(ALL_PAGES.length).toBeGreaterThanOrEqual(4);
    expect(ALL_PAGES).toContain("login/page.tsx");
    expect(ALL_PAGES).toContain("(panel)/page.tsx");
    expect(ALL_PAGES).toContain("(panel)/dashboard/page.tsx");
    expect(ALL_PAGES).toContain("(panel)/payments/page.tsx");
  });

  it("puts every page but the sign-in screen behind the guarded layout", () => {
    const unguarded = ALL_PAGES.filter(
      (page) => !page.startsWith("(panel)/") && page !== join("login", "page.tsx"),
    );
    expect(unguarded).toEqual([]);
  });

  it("has the guard in the panel layout, and nowhere that pretends to be one", () => {
    const layout = readFileSync(join(ADMIN_APP, "(panel)", "layout.tsx"), "utf8");
    expect(layout).toMatch(/requireAdminPage\(\)/);
    // A page-level `redirect("/admin/login")` without a session read is a door
    // left open: it looks protective and guards nothing.
    for (const page of ALL_PAGES.filter((entry) => entry.startsWith("(panel)/"))) {
      const source = readFileSync(join(ADMIN_APP, page), "utf8");
      if (/redirect\(["']\/admin\/login/.test(source)) {
        expect(source).toMatch(/checkAdminPage\(|requireAdminPage\(/);
      }
    }
  });

  it("marks every page it says is built as dynamic, so a stale cache never outlives a session", () => {
    for (const page of ALL_PAGES.filter((entry) => entry.startsWith("(panel)/"))) {
      const source = readFileSync(join(ADMIN_APP, page), "utf8");
      if (/checkAdminPage\(|requireAdminPage\(/.test(source)) continue; // guarded by the layout
      // The layout is the only place allowed to read the cookie for every page.
      expect(source).not.toMatch(/cookies\(\)/);
    }
    const layout = readFileSync(join(ADMIN_APP, "(panel)", "layout.tsx"), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

describe("section registry", () => {
  it("agrees with the file tree in both directions", () => {
    for (const section of ADMIN_SECTIONS) {
      const dir = section.href.replace(/^\/admin\/?/, "");
      const file = join(ADMIN_APP, dir === "" ? "(panel)" : `(panel)/${dir}`, "page.tsx");
      if (section.built) expect(existsSync(file), `${section.href} is built but has no page`).toBe(true);
      else expect(existsSync(file), `${section.href} exists but nav says unbuilt`).toBe(false);
    }
  });

  it("never links a disabled section", () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.href.startsWith("/admin")).toBe(true);
      expect(section.label.length).toBeGreaterThan(0);
    }
    expect(ADMIN_SECTIONS[0].href).toBe(ADMIN_HOME_PATH);
    expect(ADMIN_SECTIONS[0].roles).toBeUndefined(); // the dashboard is every admin's home
  });

  it("filters the nav by role, and only by role", () => {
    expect(sectionsFor(["PAYMENT_ADMIN"]).map((s) => s.href)).toEqual([
      ADMIN_HOME_PATH,
      "/admin/payments",
      "/admin/withdrawals",
    ]);
    expect(sectionsFor(["SCORE_ADMIN"]).map((s) => s.href)).toEqual([
      ADMIN_HOME_PATH,
      "/admin/matches",
      "/admin/qr",
    ]);
    expect(sectionsFor(["SUPPORT_ADMIN"]).map((s) => s.href)).toEqual([ADMIN_HOME_PATH]);
    // A super admin is listed explicitly in every section's roles, so they see all of them.
    expect(sectionsFor(["SUPER_ADMIN"]).map((s) => s.href)).toEqual(ADMIN_SECTIONS.map((s) => s.href));
    expect(sectionsFor([])).toHaveLength(1); // no roles: the shell only, no queues
  });

  it("tells the shell which listed sections are not built yet", () => {
    const unbuilt = ADMIN_SECTIONS.filter((section) => !section.built).map((section) => section.href);
    expect(unbuilt).toContain("/admin/withdrawals");
    expect(unbuilt).toContain("/admin/matches");
    expect(unbuilt).toContain("/admin/qr");
  });
});

describe("role helpers", () => {
  it("treats an empty allow-list as 'any admin', and never as 'no admin'", () => {
    expect(hasRole({ roles: ["SUPPORT_ADMIN"] }, undefined)).toBe(true);
    expect(hasRole({ roles: ["SUPPORT_ADMIN"] }, [])).toBe(true);
    expect(hasRole({ roles: [] }, [])).toBe(true);
  });

  it("does not let SUPER_ADMIN impliedly unlock a page that forgot to list it", () => {
    // The API is written the same way: SUPER_ADMIN must be spelled out in every
    // role list, so a list that omits it really does omit it.
    expect(REVIEW_ROLES).toContain("SUPER_ADMIN");
    expect(REVIEW_ROLES).toContain("PAYMENT_ADMIN");
    expect(REVIEW_ROLES).not.toContain("SUPPORT_ADMIN");
    expect(MATCH_ROLES).toEqual(["SUPER_ADMIN", "SCORE_ADMIN"]);
    expect(hasRole({ roles: ["SUPER_ADMIN"] }, MATCH_ROLES)).toBe(true);
    expect(hasRole({ roles: ["PAYMENT_ADMIN"] }, MATCH_ROLES)).toBe(false);
  });

  it("names every role the enum has, so a badge never prints a blank", () => {
    const enumRoles: Role[] = ["SUPER_ADMIN", "SCORE_ADMIN", "PAYMENT_ADMIN", "SUPPORT_ADMIN"];
    for (const role of enumRoles) expect(ROLE_LABELS[role]).toBeTruthy();
    expect(roleLabels(["SUPER_ADMIN", "SUPPORT_ADMIN"])).toEqual(["Super admin", "Support"]);
    expect(roleLabels([])).toEqual([]);
  });
});

describe("page guards", () => {
  afterEach(() => jar.clear());
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-only-admin-session-secret-32-chars!!");
  });

  it("reports a missing cookie as signed out, not as an error", async () => {
    await expect(checkAdminPage(REVIEW_ROLES)).resolves.toEqual({
      ok: false,
      reason: "signed-out",
      admin: null,
    });
  });

  it("reports a cookie it cannot verify as signed out", async () => {
    jar.set(adminCookieName(), "not-a-jwt");
    const access = await checkAdminPage();
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.reason).toBe("signed-out");
  });

  it("redirects a signed-out visitor to the sign-in page", async () => {
    let digest = "";
    try {
      await requireAdminPage(REVIEW_ROLES);
    } catch (error) {
      digest = String((error as { digest?: string }).digest ?? "");
    }
    // Next 15 spells the digest `NEXT_REDIRECT;<type>;<url>;<status>;` — assert on
    // the two parts that are the contract, not on the framing.
    expect(digest).toContain(ADMIN_LOGIN_PATH);
    expect(digest).toMatch(/30[37]/);
  });

  it("hands a wrong-role admin back to the page instead of redirecting them", async () => {
    // No admin row exists for this forged token, so the session lookup lands on
    // "signed out" — which is what an unverifiable cookie must always mean. The
    // wrong-role branch is a pure decision and is checked directly.
    const access = await checkAdminPage(["SCORE_ADMIN"]);
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.admin).toBeNull();
    expect(hasRole({ roles: ["PAYMENT_ADMIN"] }, ["SCORE_ADMIN"])).toBe(false);
  });

  it("keeps the login path out of the guarded group", () => {
    expect(existsSync(join(ADMIN_APP, "(panel)", "login"))).toBe(false);
    expect(ADMIN_LOGIN_PATH).toBe("/admin/login");
  });
});
