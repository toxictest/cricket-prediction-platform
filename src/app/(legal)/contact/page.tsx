import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Clock,
  LifeBuoy,
  Mail,
  MessageSquare,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Contact & Support",
  description:
    "Reach the Cricket Prediction Community team for access problems, account deletion, self-exclusion or security disclosures.",
  alternates: { canonical: "/contact" },
};

const CHANNELS = [
  {
    icon: LifeBuoy,
    title: "Access & registration problems",
    description:
      "Cannot sign in, no member record after Google login, referral code not applied, or download returns 401.",
    action: "support@example.com",
    href: "mailto:support@example.com?subject=Access%20problem",
    sla: "Replies within 24 hours",
    tone: "default" as const,
  },
  {
    icon: ShieldCheck,
    title: "Security disclosure",
    description:
      "Found a way to reach /api/download without a session, or another access-control flaw. Please report privately before disclosing publicly.",
    action: "security@example.com",
    href: "mailto:security@example.com?subject=Security%20disclosure",
    sla: "Acknowledged within 48 hours",
    tone: "warning" as const,
  },
  {
    icon: MessageSquare,
    title: "Account deletion & self-exclusion",
    description:
      "Request a hard delete of your member record, or ask to be added to the suppression list so no new account can be created with your email.",
    action: "support@example.com",
    href: "mailto:support@example.com?subject=Self-exclusion",
    sla: "Actioned within 24 hours",
    tone: "destructive" as const,
  },
] as const;

export default function ContactPage() {
  return (
    <div className="container">
      {/* ---------------- header ---------------- */}
      <header className="max-w-3xl">
        <Badge variant="default">
          <Mail aria-hidden="true" />
          Support
        </Badge>

        <h1 className="mt-5 text-balance font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
          Talk to the{" "}
          <span className="text-gradient-fire">operators</span>
        </h1>

        <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-zinc-400">
          There is no ticket queue or chatbot here — a small team reads every
          message. Pick the channel that matches your problem so it reaches the
          right person on the first try.
        </p>

        <div className="mt-8 h-px w-40 bg-gradient-to-r from-red-500/60 to-transparent" />
      </header>

      {/* ---------------- channels ---------------- */}
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {CHANNELS.map((channel) => {
          const Icon = channel.icon;
          return (
            <section
              key={channel.title}
              className="group flex h-full flex-col rounded-lg glass neon-border neon-border-hover p-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-red-500/45">
                <Icon className="h-5 w-5 text-red-400" aria-hidden="true" />
              </span>

              <h2 className="mt-5 font-display text-base font-semibold leading-snug text-white">
                {channel.title}
              </h2>

              <p className="mt-2.5 flex-1 text-[13.5px] leading-relaxed text-zinc-400">
                {channel.description}
              </p>

              <p className="mt-4 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
                <Clock className="h-3 w-3 text-red-500/60" aria-hidden="true" />
                {channel.sla}
              </p>

              <a href={channel.href} className="mt-5 block">
                <Button variant="cyber" size="sm" className="w-full">
                  <Mail aria-hidden="true" />
                  {channel.action}
                </Button>
              </a>
            </section>
          );
        })}
      </div>

      {/* ---------------- before you write ---------------- */}
      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className="rounded-lg glass-strong neon-border p-6 sm:p-7">
          <h2 className="flex items-center gap-2.5 font-display text-lg font-bold text-white">
            <BookOpen className="h-4.5 w-4.5 text-red-400" aria-hidden="true" />
            Before you write
          </h2>

          <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-400">
            These four checks resolve the large majority of support requests
            without a round trip:
          </p>

          <ol className="mt-5 space-y-4">
            {[
              {
                title: "Check the health endpoint",
                body: (
                  <>
                    Open{" "}
                    <Link
                      href="/api/health"
                      className="font-mono text-[12.5px] text-red-400 underline-offset-4 hover:underline"
                    >
                      /api/health
                    </Link>{" "}
                    in a new tab. If it returns <code>503</code>, the API or
                    PostgreSQL is down and the problem is not on your side.
                  </>
                ),
              },
              {
                title: "Confirm your member record exists",
                body: (
                  <>
                    Visit{" "}
                    <Link
                      href="/dashboard"
                      className="text-red-400 underline-offset-4 hover:underline"
                    >
                      /dashboard
                    </Link>
                    . If it redirects you to sign in, your session expired — sign
                    in again to refresh it.
                  </>
                ),
              },
              {
                title: "Clear the stale session",
                body: "Sign out fully, then sign back in. This re-issues your JSON Web Token and re-syncs your member record from the database.",
              },
              {
                title: "Include the diagnostic digest",
                body: "If you hit an error page, copy the digest string it displays. That identifier maps directly to the matching server log line.",
              },
            ].map((item, index) => (
              <li key={item.title} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-red-500/35 bg-red-500/10 font-mono text-[11px] font-bold text-red-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-zinc-200">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-zinc-500">
                    {item.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------- response SLA card ---------------- */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-white/[0.07] bg-black/40 p-5">
            <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              <Terminal className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
              Channel status
            </p>

            <ul className="mt-4 space-y-3">
              {[
                { k: "Email", v: "Open" },
                { k: "Median reply", v: "6h 12m" },
                { k: "Backlog", v: "0 tickets" },
                { k: "Coverage", v: "Mon–Sat" },
              ].map(({ k, v }) => (
                <li
                  key={k}
                  className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2.5 last:border-0 last:pb-0"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                    {k}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-red-400">
                    {v}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg glass neon-border p-5">
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Looking for the platform rules instead? The{" "}
              <Link
                href="/terms"
                className="text-red-400 underline-offset-4 hover:underline"
              >
                Terms
              </Link>
              ,{" "}
              <Link
                href="/privacy"
                className="text-red-400 underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link
                href="/responsible-play"
                className="text-red-400 underline-offset-4 hover:underline"
              >
                Responsible Play
              </Link>{" "}
              pages answer most policy questions in detail.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
