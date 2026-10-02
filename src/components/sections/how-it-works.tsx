"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { steps } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/effects/section-heading";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";

/* ==========================================================================
   SECTION
   ========================================================================== */

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-24 overflow-hidden py-20 sm:py-24 lg:py-28"
      aria-labelledby="how-it-works-heading"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent"
      />

      {/* corner grid wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 cyber-grid-fine opacity-[0.35] mask-fade-y"
      />

      <div className="container relative">
        <SectionHeading
          eyebrow="02 / Protocol"
          title={
            <span id="how-it-works-heading">
              Four steps from{" "}
              <span className="text-gradient-fire">visitor</span> to connected
            </span>
          }
          description="No forms to fill, no passwords to remember. Google verifies you, PostgreSQL remembers you, and the terminal does the rest."
        />

        <StaggerGroup
          className="relative mt-16 grid gap-6 lg:grid-cols-4 lg:gap-5"
          stagger={0.11}
        >
          {/* connecting rail (desktop only) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 top-[3.4rem] hidden h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent lg:block"
          />

          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <StaggerItem key={step.index} className="relative h-full">
                <article
                  className={cn(
                    "group relative flex h-full flex-col overflow-hidden rounded-lg p-6",
                    "glass neon-border neon-border-hover",
                  )}
                >
                  {/* step number watermark */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-2 -top-4 select-none font-display text-[5.5rem] font-extrabold leading-none text-white/[0.028] transition-colors duration-500 group-hover:text-red-500/[0.07]"
                  >
                    {step.index}
                  </span>

                  <div className="relative flex items-center gap-3">
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-red-500/35 bg-zinc-950/80 shadow-[0_0_18px_rgba(239,68,68,0.22)] transition-all duration-400 ease-cyber group-hover:border-red-400/70 group-hover:shadow-[0_0_26px_rgba(239,68,68,0.5)]">
                      <Icon className="h-[19px] w-[19px] text-red-400" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-red-500/70">
                      Step {step.index}
                    </span>
                  </div>

                  <h3 className="relative mt-5 font-display text-base font-semibold leading-snug text-white">
                    {step.title}
                  </h3>

                  <p className="relative mt-2.5 flex-1 text-[13.5px] leading-relaxed text-zinc-400">
                    {step.description}
                  </p>

                  {/* command chip */}
                  <div className="relative mt-5 overflow-hidden rounded border border-white/[0.07] bg-black/50 px-3 py-2.5">
                    <code className="block truncate font-mono text-[10.5px] text-emerald-400/85">
                      <span className="mr-1.5 select-none text-red-500">$</span>
                      {step.command}
                    </code>
                  </div>
                </article>
              </StaggerItem>
            );
          })}
        </StaggerGroup>

        {/* ---------------- CTA strip ---------------- */}
        <Reveal variant="up" delay={0.1}>
          <div
            className={cn(
              "relative mt-14 overflow-hidden rounded-lg p-7 sm:p-9",
              "glass-strong neon-border",
            )}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 top-1/2 h-52 w-52 -translate-y-1/2 rounded-full bg-red-600/[0.13] blur-[70px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 top-1/2 h-52 w-52 -translate-y-1/2 rounded-full bg-red-600/[0.13] blur-[70px]"
            />

            <div className="relative flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
              <div className="max-w-xl">
                <h3 className="font-display text-xl font-bold text-white sm:text-2xl">
                  The gate is the only thing standing between you and the build.
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">
                  One Google sign-in creates your member record, allocates your
                  referral code and unlocks the Download Center permanently.
                </p>
              </div>

              <Link href="/register" className="w-full shrink-0 sm:w-auto">
                <Button size="lg" variant="default" className="group w-full sm:w-auto">
                  <ShieldCheck aria-hidden="true" />
                  Activate Account
                  <ArrowRight
                    className="transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Button>
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default HowItWorks;
