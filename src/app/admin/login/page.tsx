import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Fingerprint, Terminal } from "lucide-react";
import { getAdminPrincipal } from "@/lib/admin-guard";
import { ADMIN_HOME_PATH } from "@/lib/admin-web";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AdminLoginForm } from "@/components/admin/admin-login-form";

export const metadata: Metadata = {
  title: "Admin sign-in",
  description: "Staff sign-in for the back office.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * `/admin/login` — the one admin URL that is not guarded.
 *
 * An operator who is already signed in is moved on immediately: the panel layout
 * verifies the session against `admin_sessions` on every render, so a session that
 * was revoked or expired fails here and lands back on this form rather than
 * half-rendering a queue.
 */
export default async function AdminLoginPage() {
  const admin = await getAdminPrincipal();
  if (admin) redirect(ADMIN_HOME_PATH);

  const showBootstrapHint = process.env.NODE_ENV !== "production";

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 cyber-grid-overlay opacity-70" />
      <div aria-hidden="true" className="pointer-events-none absolute -inset-24 bg-red-600/[0.07] blur-[120px]" />

      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="container flex h-16 items-center justify-between gap-4">
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 font-display text-[13px] font-black text-red-300">
              CP
            </span>
            <span className="font-display text-[13px] font-extrabold uppercase tracking-[0.16em] text-white">
              Control
            </span>
          </span>

          <Link
            href="/"
            className="group inline-flex items-center gap-2 rounded-md px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-red-400"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" aria-hidden="true" />
            Public site
          </Link>
        </div>
      </header>

      <main id="main" className="container relative z-10 flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-md">
          <div className="mb-7 text-center">
            <Badge variant="neon" className="mb-5">
              <Fingerprint aria-hidden="true" />
              Staff only
            </Badge>
            <h1 className="text-balance font-display text-[1.9rem] font-extrabold leading-tight text-white">
              Back office
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-pretty text-[14px] leading-relaxed text-zinc-400">
              Members sign in with Google on the public site. This screen is for admin
              accounts, and every action you take here is served by the same guarded API
              the Android app never sees.
            </p>
          </div>

          <div className="relative">
            <div aria-hidden="true" className="absolute -inset-5 rounded-3xl bg-red-600/[0.09] blur-[60px]" />
            <div className={cn("relative overflow-hidden rounded-lg p-6 sm:p-7", "glass-strong neon-border corner-brackets")}>
              <div className="mb-6 flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                <span className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  <Terminal className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
                  Admin channel
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
                  JWT · 8 h
                </span>
              </div>

              <AdminLoginForm />
            </div>
          </div>

          {showBootstrapHint && (
            <p className="mt-6 text-center font-mono text-[9.5px] leading-relaxed tracking-wide text-zinc-600">
              no account yet? in a development database:{" "}
              <code className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-zinc-400">
                npm run admin:create-super
              </code>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
