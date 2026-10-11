import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getAdminPrincipal, type AdminPrincipal } from "@/lib/admin-guard";

/* ==========================================================================
   ADMIN PANEL — PAGE-SIDE GUARDS
   ==========================================================================

   The API has `requireAdmin()`, which answers a fetch with 401/403. A page has
   nothing to answer with: it either renders or it redirects. This is that
   other half, and it reads the same session the API does — one source of truth
   for "who is signed in", so a page can never claim an operator is someone the
   API would refuse.

   Two rules worth stating:

   - A signed-out visitor is redirected to the sign-in page. That is the only
     redirect: sending a *wrong-role* admin away would bounce them straight back
     from any page they can reach, which is a loop with extra steps.
   - Roles are checked here for rendering, and again in every route handler for
     acting. Hiding a button is a courtesy; the endpoint is the boundary.
   ========================================================================== */

// Re-exported so a server page can import both halves from one place; a *client*
// component must import them from `@/lib/admin-paths` directly.
export { ADMIN_HOME_PATH, ADMIN_LOGIN_PATH } from "@/lib/admin-paths";
import { ADMIN_HOME_PATH, ADMIN_LOGIN_PATH } from "@/lib/admin-paths";

/** The queues. The API accepts PAYMENT_ADMIN or SUPER_ADMIN on both. */
export const REVIEW_ROLES: Role[] = ["SUPER_ADMIN", "PAYMENT_ADMIN"];

/** The fixture calendar, the scoreboard and the payment QR attached to a fixture. */
export const MATCH_ROLES: Role[] = ["SUPER_ADMIN", "SCORE_ADMIN"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  SCORE_ADMIN: "Score admin",
  PAYMENT_ADMIN: "Payment admin",
  SUPPORT_ADMIN: "Support",
};

export function hasRole(admin: Pick<AdminPrincipal, "roles">, roles?: Role[]): boolean {
  if (!roles || roles.length === 0) return true;
  return roles.some((role) => admin.roles.includes(role));
}

export type AdminPageAccess =
  | { ok: true; admin: AdminPrincipal }
  | { ok: false; reason: "signed-out"; admin: null }
  | { ok: false; reason: "wrong-role"; admin: AdminPrincipal };

/** Ask, do not act: for a page that shows a friendly notice instead of redirecting. */
export async function checkAdminPage(roles?: Role[]): Promise<AdminPageAccess> {
  const admin = await getAdminPrincipal();
  if (!admin) return { ok: false, reason: "signed-out", admin: null };
  if (!hasRole(admin, roles)) return { ok: false, reason: "wrong-role", admin };
  return { ok: true, admin };
}

/**
 * Guard for the panel layout. Returns the signed-in admin, or redirects to the
 * sign-in page and never returns.
 *
 * `roles` is optional here on purpose: the shell is the same for every admin, and
 * a page that needs more than a session says so itself with `checkAdminPage`.
 */
export async function requireAdminPage(roles?: Role[]): Promise<AdminPrincipal> {
  const access = await checkAdminPage(roles);
  if (!access.ok) {
    if (access.reason === "wrong-role") return access.admin;
    redirect(ADMIN_LOGIN_PATH);
  }
  return access.admin;
}

/**
 * The panel's sections, in nav order, with what each one needs.
 *
 * `built` is the honest flag: a section that has no page yet is listed as
 * unavailable instead of linking to a 404, and `tests/admin-web.test.ts` asserts
 * that the flag and the file tree agree in both directions. Flipping a section to
 * `built: true` is the only nav change an added page needs.
 */
export type AdminSection = {
  href: string;
  label: string;
  hint: string;
  icon: "dashboard" | "payments" | "matches" | "qr";
  /** Roles allowed to see it at all. Omitted means every admin. */
  roles?: Role[];
  built: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: ADMIN_HOME_PATH, label: "Dashboard", hint: "Queues at a glance", icon: "dashboard", built: true },
  { href: "/admin/payments", label: "Payments", hint: "Deposit claims to review", icon: "payments", roles: REVIEW_ROLES, built: true },
  { href: "/admin/withdrawals", label: "Withdrawals", hint: "Payout requests to confirm", icon: "payments", roles: REVIEW_ROLES, built: false },
  { href: "/admin/matches", label: "Matches", hint: "Fixtures and the live scoreboard", icon: "matches", roles: MATCH_ROLES, built: false },
  { href: "/admin/qr", label: "Payment QR", hint: "Which fixture members pay into", icon: "qr", roles: MATCH_ROLES, built: false },
];

/** What this admin can reach, in nav order. Unbuilt sections stay visible but inert. */
export function sectionsFor(roles: Role[]): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => hasRole({ roles }, section.roles));
}

/** Label for the one role badge the panel shows. Unknown roles print as-is. */
export function roleLabels(roles: Role[]): string[] {
  return roles.map((role) => ROLE_LABELS[role] ?? role);
}
