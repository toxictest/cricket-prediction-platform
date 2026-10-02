"use client";

import { features, type Feature } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/effects/section-heading";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";

/* ==========================================================================
   ACCENT MAP
   Kept static (rather than interpolated) so Tailwind's JIT scanner sees the
   complete class strings at build time.
   ========================================================================== */

const ACCENTS: Record<
  Feature["accent"],
  { icon: string; glow: string; ring: string; badge: string }
> = {
  red: {
    icon: "text-red-400 group-hover:text-red-300",
    glow: "bg-red-600/[0.16] group-hover:bg-red-600/[0.30]",
    ring: "group-hover:border-red-500/60",
    badge: "default" as const as string,
  },
  amber: {
    icon: "text-amber-400 group-hover:text-amber-300",
    glow: "bg-amber-600/[0.14] group-hover:bg-amber-600/[0.26]",
    ring: "group-hover:border-amber-500/50",
    badge: "warning" as const as string,
  },
  cyan: {
    icon: "text-cyan-400 group-hover:text-cyan-300",
    glow: "bg-cyan-600/[0.13] group-hover:bg-cyan-600/[0.24]",
    ring: "group-hover:border-cyan-500/50",
    badge: "info" as const as string,
  },
  lime: {
    icon: "text-lime-400 group-hover:text-lime-300",
    glow: "bg-lime-600/[0.12] group-hover:bg-lime-600/[0.22]",
    ring: "group-hover:border-lime-500/50",
    badge: "success" as const as string,
  },
};

/* ==========================================================================
   CARD
   ========================================================================== */

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  const accent = ACCENTS[feature.accent];

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-lg p-6 sm:p-7",
        "glass neon-border corner-brackets neon-border-hover",
      )}
    >
      {/* radial hover wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-red-600/[0.10] blur-[50px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="relative">
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-0 rounded-md blur-lg transition-all duration-500",
              accent.glow,
            )}
          />
          <div
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-md",
              "border border-white/[0.08] bg-zinc-950/70 backdrop-blur",
              "transition-all duration-400 ease-cyber",
              "group-hover:-translate-y-0.5 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.28)]",
            )}
          >
            <Icon
              className={cn("h-[22px] w-[22px] transition-colors", accent.icon)}
              aria-hidden="true"
            />
          </div>
        </div>

        <Badge variant="outline" className="shrink-0 group-hover:border-red-500/40 group-hover:text-red-300">
          {feature.tag}
        </Badge>
      </div>

      <h3 className="relative mt-6 font-display text-lg font-semibold leading-snug text-white transition-colors group-hover:text-white">
        {feature.title}
      </h3>

      <p className="relative mt-3 flex-1 text-sm leading-relaxed text-zinc-400">
        {feature.description}
      </p>

      {/* animated bottom rail */}
      <div
        aria-hidden="true"
        className="relative mt-6 h-px w-full overflow-hidden bg-white/[0.06]"
      >
        <span className="absolute inset-y-0 left-0 w-0 bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_10px_rgba(239,68,68,0.9)] transition-all duration-500 ease-cyber group-hover:w-full" />
      </div>
    </article>
  );
}

/* ==========================================================================
   SECTION
   ========================================================================== */

export function Features() {
  return (
    <section
      id="features"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
      aria-labelledby="features-heading"
    >
      {/* subtle section separator */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"
      />

      <div className="container">
        <SectionHeading
          eyebrow="01 / Capabilities"
          title={
            <span id="features-heading">
              Everything the{" "}
              <span className="text-gradient-fire">terminal</span> gives you
            </span>
          }
          description="Six modules working together: modelling, crowd intelligence, live analytics and a referral engine that rewards the members who grow the network."
        />

        <StaggerGroup
          className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6"
          stagger={0.08}
        >
          {features.map((feature) => (
            <StaggerItem key={feature.title} className="h-full">
              <FeatureCard feature={feature} />
            </StaggerItem>
          ))}
        </StaggerGroup>

        <Reveal variant="in" delay={0.1}>
          <p className="mt-12 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
            + 14 more modules inside the Android terminal
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export default Features;
