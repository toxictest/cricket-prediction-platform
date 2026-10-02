"use client";

import Link from "next/link";
import { Github, Mail, ShieldCheck, Terminal, Twitter } from "lucide-react";
import { footerNav, siteConfig } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/layout/navbar";
import { cn } from "@/lib/utils";

function NavColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ readonly label: string; readonly href: string }>;
}) {
  return (
    <div>
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-red-500/80">
        {title}
      </h3>
      <ul className="mt-5 space-y-3">
        {links.map((link) => (
          <li key={`${title}-${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className={cn(
                "group inline-flex items-center gap-2 text-sm text-zinc-400",
                "transition-colors duration-250 hover:text-white",
              )}
            >
              <span
                aria-hidden="true"
                className="h-px w-0 bg-red-500 transition-all duration-300 ease-cyber group-hover:w-3"
              />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-24 overflow-hidden border-t border-white/[0.06]">
      {/* top glow rail */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
      <div className="absolute left-1/2 top-0 h-40 w-[42rem] -translate-x-1/2 rounded-full bg-red-600/[0.07] blur-[100px]" />

      <div className="relative container py-14 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* ---------------- brand ---------------- */}
          <div className="max-w-sm">
            <Logo />

            <p className="mt-5 text-sm leading-relaxed text-zinc-500">
              A members-only cricket prediction community. Register once, join
              the network and unlock the Android terminal.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Badge variant="default">
                <ShieldCheck aria-hidden="true" />
                Verified members
              </Badge>
              <Badge variant="secondary">
                <Terminal aria-hidden="true" />
                v{siteConfig.appVersion}
              </Badge>
            </div>

            <div className="mt-6 flex items-center gap-2">
              {[
                { icon: Github, label: "GitHub", href: "#" },
                { icon: Twitter, label: "X", href: "#" },
                { icon: Mail, label: "Email", href: "mailto:support@example.com" },
              ].map(({ icon: Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md",
                    "border border-white/[0.08] bg-white/[0.02] text-zinc-500",
                    "transition-all duration-300 ease-cyber",
                    "hover:-translate-y-0.5 hover:border-red-500/50 hover:text-red-400",
                    "hover:shadow-[0_0_16px_rgba(239,68,68,0.35)]",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {/* ---------------- link columns ---------------- */}
          <NavColumn title="Platform" links={footerNav.platform} />
          <NavColumn title="Account" links={footerNav.account} />
          <NavColumn title="Legal" links={footerNav.legal} />
        </div>

        {/* ---------------- status strip ---------------- */}
        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-white/[0.06] bg-white/[0.015] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
            API: operational
          </span>
          <span className="hidden h-3 w-px bg-white/10 sm:block" />
          <span>Postgres: connected</span>
          <span className="hidden h-3 w-px bg-white/10 sm:block" />
          <span>Region: ap-south-1</span>
          <a
            href="/api/health"
            className="ml-auto text-zinc-600 transition-colors hover:text-red-400"
            target="_blank"
            rel="noreferrer"
          >
            /api/health →
          </a>
        </div>

        {/* ---------------- legal ---------------- */}
        <div className="mt-8 flex flex-col gap-4 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-zinc-600">
            © {year} {siteConfig.name}. All rights reserved.
          </p>

          <p className="max-w-md font-mono text-[10px] leading-relaxed text-zinc-600">
            For research and entertainment only. Not financial advice. 18+.
            Please play responsibly.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
