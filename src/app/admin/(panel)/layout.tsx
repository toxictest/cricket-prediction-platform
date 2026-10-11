import { moneyModeEnabled } from "@/lib/feature-flags";
import { requireAdminPage, roleLabels, sectionsFor } from "@/lib/admin-web";
import { AdminShell } from "@/components/admin/admin-shell";

export const dynamic = "force-dynamic";

/**
 * The guard for the whole panel.
 *
 * `middleware.ts` deliberately does not know about `/admin`: it authenticates
 * members against the NextAuth cookie, while staff hold a separate `HttpOnly`
 * session cookie. So this layout is the wall — `requireAdminPage()` resolves that
 * cookie against `admin_sessions` on every request, clears it when it is stale,
 * and redirects to `/admin/login` otherwise. The API routes the panel calls
 * re-check the same session; a page that forgot its role gate can therefore show
 * a shell, never somebody else's data.
 *
 * A signed-in admin who lacks a section's roles is *not* redirected away from it
 * (that would bounce forever) — the page renders a short notice instead.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();

  const nav = sectionsFor(admin.roles).map((section) => ({
    href: section.href,
    label: section.label,
    hint: section.hint,
    icon: section.icon,
    unavailable: !section.built,
  }));

  return (
    <AdminShell
      nav={nav}
      moneyModeOff={!moneyModeEnabled()}
      operator={{
        name: admin.name,
        email: admin.email,
        roleLabels: roleLabels(admin.roles),
        sessionExpiresAt: admin.sessionExpiresAt.toISOString(),
      }}
    >
      {children}
    </AdminShell>
  );
}
