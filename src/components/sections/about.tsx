"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  Lock,
  ServerCog,
  Users,
} from "lucide-react";
import { pillars } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/effects/section-heading";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";

/* ==========================================================================
   ARCHITECTURE DIAGRAM
   ========================================================================== */

const STACK_ROWS = [
  {
    icon: Users,
    layer: "Client",
    tech: "Next.js 15 App Router · React 19 · Tailwind · shadcn/ui",
  },
  {
    icon: Lock,
    layer: "Auth",
    tech: "NextAuth v4 · Google OAuth 2.0 · JWT sessions · Edge middleware",
  },
  {
    icon: ServerCog,
    layer: "API",
    tech: "Route Handlers · Zod validation · Rate limiting · Audit logging",
  },
  {
    icon: Database,
    layer: "Data",
    tech: "Prisma ORM 6 · PostgreSQL 17 · Unique referral allocation",
  },
] as const;

function ArchitecturePanel() {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Reveal the topology rows only once the panel is actually on screen, so the
  // staggered animation is never wasted above the fold.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "-80px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-4 rounded-2xl bg-red-600/[0.07] blur-[60px]"
      />

      <div className={cn("relative overflow-hidden rounded-lg glass-strong neon-border")}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <span className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            <ServerCog className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
            Platform topology
          </span>
          <Badge variant="success">
            <Activity aria-hidden="true" />
            All layers up
          </Badge>
        </div>

        {/* rows */}
        <ul className="divide-y divide-white/[0.055]">
          {STACK_ROWS.map((row, index) => {
            const Icon = row.icon;
            return (
              <li
                key={row.layer}
                className={cn(
                  "group flex items-start gap-4 px-5 py-4 transition-colors",
                  "hover:bg-red-500/[0.035]",
                  mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                )}
                style={{
                  transition:
                    "transform 600ms cubic-bezier(0.22,1,0.36,1), opacity 600ms cubic-bezier(0.22,1,0.36,1), background-color 250ms",
                  transitionDelay: `${index * 90}ms`,
                }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-red-500/40">
                  <Icon className="h-4 w-4 text-red-400" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold text-white">
                    {row.layer}
                  </p>
                  <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-zinc-500">
                    {row.tech}
                  </p>
                </div>

                <CheckCircle2
                  className="mt-1 h-4 w-4 shrink-0 text-emerald-500/70"
                  aria-hidden="true"
                />
              </li>
            );
          })}
        </ul>

        {/* footer readout */}
        <div className="grid grid-cols-3 divide-x divide-white/[0.055] border-t border-white/[0.07] bg-black/30">
          {[
            { k: "Referral space", v: "32⁸" },
            { k: "Collisions", v: "0" },
            { k: "Gate", v: "Server-side" },
          ].map(({ k, v }) => (
            <div key={k} className="px-4 py-3.5 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
                {k}
              </p>
              <p className="mt-1 font-mono text-xs font-semibold text-red-400">
                {v}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   SECTION
   ========================================================================== */

export function About() {
  return (
    <section
      id="about"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
      aria-labelledby="about-heading"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"
      />

      <div className="container">
        <div className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-16">
          {/* ---------------- left: narrative ---------------- */}
          <div className="lg:sticky lg:top-28">
            <SectionHeading
              align="left"
              eyebrow="03 / About"
              title={
                <span id="about-heading">
                  Built like{" "}
                  <span className="text-gradient-fire">infrastructure</span>,
                  not like a tipster channel
                </span>
              }
              description="Most cricket prediction groups live inside a chat app: a screenshot, a claim, no traceability. This platform is the opposite — every projection is produced by an auditable model, every member is a verified identity, and every download is tied to an account you own."
            />

            <Reveal variant="up" delay={0.15}>
              <div className="mt-9 flex flex-wrap gap-2">
                <Badge variant="default">Google-verified identities</Badge>
                <Badge variant="secondary">No password storage</Badge>
                <Badge variant="outline">GDPR-aware delete</Badge>
                <Badge variant="outline">Audited downloads</Badge>
              </div>
            </Reveal>

            <Reveal variant="up" delay={0.22}>
              <div className="mt-9 rounded-lg glass neon-border p-5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-red-500/80">
                  Design principle
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-zinc-300">
                  &ldquo;Make the gate real.&rdquo; The Download Center is not
                  hidden with CSS — the middleware and the API both verify your
                  session, so the artifact is genuinely unreachable without an
                  account.
                </p>
              </div>
            </Reveal>
          </div>

          {/* ---------------- right: pillars + topology ---------------- */}
          <div className="space-y-10">
            <StaggerGroup className="grid gap-4 sm:grid-cols-2" stagger={0.07}>
              {pillars.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <StaggerItem key={pillar.title} className="h-full">
                    <div className="group h-full rounded-lg glass neon-border p-5 transition-all duration-350 ease-cyber hover:border-red-500/45 hover:shadow-[0_0_24px_rgba(239,68,68,0.2)]">
                      <span className="flex h-9 w-9 items-center justify-center rounded border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-red-500/40">
                        <Icon className="h-4 w-4 text-red-400" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 font-display text-[15px] font-semibold text-white">
                        {pillar.title}
                      </h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                        {pillar.body}
                      </p>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerGroup>

            <Reveal variant="scale" delay={0.1}>
              <ArchitecturePanel />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export default About;
