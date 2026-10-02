import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Fingerprint, ShieldCheck, Terminal } from "lucide-react";
import { Logo } from "@/components/layout/navbar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Two-column shell shared by `/login` and `/register`.
 *
 * Renders as a Server Component — only the form itself is a client island, so
 * the decorative panel costs nothing in the client bundle.
 */
export function AuthShell({
  children,
  eyebrow,
  title,
  subtitle,
  footer,
  /** Small print shown beneath the form card. */
  footnote,
}: {
  children: ReactNode;
  eyebrow: string;
  title: ReactNode;
  subtitle: ReactNode;
  footer?: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      {/* ---------------- top bar ---------------- */}
      <header className="relative z-20 border-b border-white/[0.06]">
        <div className="container flex h-16 items-center justify-between gap-4 sm:h-[72px]">
          <Logo />

          <Link
            href="/"
            className={cn(
              "group inline-flex items-center gap-2 rounded-md px-3 py-2",
              "font-mono text-[10px] font-semibold uppercase tracking-[0.16em]",
              "text-zinc-500 transition-colors hover:text-red-400",
            )}
          >
            <ArrowLeft
              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1"
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Back to home</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <main
        id="main"
        className="container relative z-10 flex flex-1 items-center py-10 sm:py-14"
      >
        <div className="grid w-full items-center gap-14 lg:grid-cols-[1fr_minmax(0,29rem)] lg:gap-20 xl:gap-28">
          {/* ============ left: narrative (desktop only) ============ */}
          <div className="hidden lg:block">
            <Badge variant="neon" className="mb-6">
              <Fingerprint aria-hidden="true" />
              {eyebrow}
            </Badge>

            <h1 className="max-w-xl text-balance font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white xl:text-[2.9rem]">
              {title}
            </h1>

            <p className="mt-6 max-w-lg text-pretty text-[15px] leading-relaxed text-zinc-400">
              {subtitle}
            </p>

            {/* process readout */}
            <div className="mt-12 space-y-2.5">
              {[
                { step: "01", text: "Google verifies your identity" },
                { step: "02", text: "A member row is written to PostgreSQL" },
                { step: "03", text: "A unique referral code is allocated" },
                { step: "04", text: "The Android build unlocks on your account" },
              ].map(({ step, text }, index) => (
                <div
                  key={step}
                  className="group flex items-center gap-4 rounded-md border border-white/[0.055] bg-white/[0.015] px-4 py-3 transition-colors hover:border-red-500/35 hover:bg-red-500/[0.04]"
                  style={{
                    animation: `float 6s ease-in-out ${index * 0.4}s infinite`,
                  }}
                >
                  <span className="font-mono text-[10px] font-bold text-red-500/70">
                    {step}
                  </span>
                  <span className="text-[13px] text-zinc-400 transition-colors group-hover:text-zinc-200">
                    {text}
                  </span>
                </div>
              ))}
            </div>

            {/* security footer */}
            <div className="mt-12 flex items-center gap-5 border-t border-white/[0.06] pt-6">
              <span className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
                <ShieldCheck className="h-3.5 w-3.5 text-red-500/60" aria-hidden="true" />
                OAuth 2.0
              </span>
              <span className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
                <Terminal className="h-3.5 w-3.5 text-red-500/60" aria-hidden="true" />
                JWT · 30 days
              </span>
            </div>
          </div>

          {/* ============ right: form card ============ */}
          <div className="mx-auto w-full max-w-md lg:mx-0">
            {/* mobile heading */}
            <div className="mb-8 text-center lg:hidden">
              <Badge variant="neon" className="mb-5">
                <Fingerprint aria-hidden="true" />
                {eyebrow}
              </Badge>
              <h1 className="text-balance font-display text-[1.7rem] font-extrabold leading-tight text-white sm:text-3xl">
                {title}
              </h1>
              <p className="mx-auto mt-4 max-w-sm text-pretty text-[14.5px] leading-relaxed text-zinc-400">
                {subtitle}
              </p>
            </div>

            {/* the card */}
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-5 rounded-3xl bg-red-600/[0.09] blur-[60px]"
              />

              <div
                className={cn(
                  "relative overflow-hidden rounded-lg p-6 sm:p-7",
                  "glass-strong neon-border corner-brackets",
                )}
              >
                {/* card chrome */}
                <div className="mb-6 flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                  <span className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                    <Terminal className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
                    Secure channel
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-emerald-400/80">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    online
                  </span>
                </div>

                {children}
              </div>
            </div>

            {footer && <div className="mt-6">{footer}</div>}
            {footnote && (
              <p className="mt-6 text-center font-mono text-[9.5px] leading-relaxed tracking-wide text-zinc-600">
                {footnote}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
