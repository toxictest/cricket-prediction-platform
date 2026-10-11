"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CircleDollarSign,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* ==========================================================================
   THE PANEL SHELL
   ==========================================================================

   Client island for the chrome: it needs the pathname to highlight the active
   section and a router to sign out without a full reload. The navigation itself
   is handed in as data by the server layout, because which sections exist is a
   function of the signed-in admin's roles and that belongs on the server.
   ========================================================================== */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "payments" | "matches" | "qr";
  hint?: string;
  /** Listed so the operator can see it is coming, not clickable until it exists. */
  unavailable?: boolean;
};

export type AdminShellOperator = {
  name: string;
  email: string;
  roleLabels: string[];
  sessionExpiresAt: string;
};

const ICONS = {
  dashboard: LayoutDashboard,
  payments: CircleDollarSign,
  matches: ShieldAlert,
  qr: QrCode,
} as const;

export function AdminShell({
  nav,
  operator,
  moneyModeOff,
  children,
}: {
  nav: AdminNavItem[];
  operator: AdminShellOperator;
  moneyModeOff: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`logout returned ${response.status}`);
      }
      toast.success("Signed out", { description: "Your admin session was revoked." });
      router.replace("/admin/login");
      router.refresh();
    } catch (error) {
      console.error("[admin-panel] sign out failed:", error);
      toast.error("Could not sign you out", {
        description: "The server did not answer. Close this tab to be sure the session ends.",
      });
    } finally {
      setSigningOut(false);
    }
  }

  const links = (
    <ul className="space-y-1">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        if (item.unavailable) {
          return (
            <li key={item.href}>
              <span
                aria-disabled="true"
                className={cn(
                  "flex cursor-not-allowed items-center gap-3 rounded-md border border-transparent px-3 py-2.5",
                  "text-zinc-600",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
                    {item.label}
                  </span>
                  {item.hint && <span className="mt-0.5 block truncate text-[11px]">{item.hint}</span>}
                </span>
                <Badge variant="outline" className="shrink-0 text-[8.5px]">
                  soon
                </Badge>
              </span>
            </li>
          );
        }
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-all duration-200",
                active
                  ? "border-red-500/45 bg-red-500/[0.09] text-white shadow-[0_0_18px_rgba(239,68,68,0.18)]"
                  : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.03] hover:text-zinc-100",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active ? "text-red-400" : "text-zinc-500 group-hover:text-red-400/80",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
                  {item.label}
                </span>
                {item.hint && (
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{item.hint}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="relative min-h-[100dvh] lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      {/* ---------------- sidebar (desktop) ---------------- */}
      <aside className="sticky top-0 hidden h-[100dvh] flex-col border-r border-white/[0.06] bg-zinc-950/60 px-5 py-6 backdrop-blur-xl lg:flex">
        <Link href="/admin/dashboard" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 font-display text-[13px] font-black text-red-300">
            CP
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[13px] font-extrabold uppercase tracking-[0.14em] text-white">
              Control
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
              back office
            </span>
          </span>
        </Link>

        <nav className="mt-8 flex-1" aria-label="Admin sections">
          {links}
        </nav>

        <div className="mt-6 border-t border-white/[0.06] pt-5">
          <p className="truncate font-mono text-[11px] font-semibold text-zinc-200">
            {operator.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">{operator.email}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {operator.roleLabels.map((label) => (
              <Badge key={label} variant="outline" className="text-[9px]">
                {label}
              </Badge>
            ))}
          </div>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
            session ends {formatDateTime(operator.sessionExpiresAt)}
          </p>
        </div>
      </aside>

      {/* ---------------- main column ---------------- */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-zinc-950/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-300 lg:hidden"
            aria-expanded={open}
            aria-controls="admin-nav"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            <span className="sr-only">Toggle sections</span>
          </button>

          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 lg:hidden">
            <FlaskConical className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
            back office
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600 sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {operator.name}
            </span>
            <Button variant="ghost" size="sm" loading={signingOut} loadingText="Signing out" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </header>

        {/* mobile nav drawer */}
        {open && (
          <nav
            id="admin-nav"
            aria-label="Admin sections"
            className="border-b border-white/[0.06] bg-zinc-950/95 px-4 py-3 lg:hidden"
          >
            {links}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
              {operator.roleLabels.map((label) => (
                <Badge key={label} variant="outline" className="text-[9px]">
                  {label}
                </Badge>
              ))}
            </div>
          </nav>
        )}

        {moneyModeOff && (
          <div className="border-b border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 sm:px-6">
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-amber-200/90">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
                  MONEY_MODE is off.
                </span>{" "}
                Balances and queues can be read, but approving, rejecting and paying out are
                refused with 503. Turn the flag on only where counsel has cleared the flow.
              </span>
            </p>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
