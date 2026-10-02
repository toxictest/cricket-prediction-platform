"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import { siteConfig, stats } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalWindow, type TerminalLine } from "@/components/effects/terminal-window";
import { GlitchText } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";

/* ==========================================================================
   BOOT LOG
   ========================================================================== */

const BOOT_LOG: TerminalLine[] = [
  { text: "init cpc-terminal --env production", tone: "command", delay: 320 },
  { text: "handshake with auth.cricket-prediction.net ......... OK", tone: "success" },
  { text: "mounting module [ match-intelligence ] ............ OK", tone: "default" },
  { text: "mounting module [ community-consensus ] ........... OK", tone: "default" },
  { text: "mounting module [ live-analytics ] ................ OK", tone: "default" },
  {
    text: "gate check: /download → requires verified member token",
    tone: "warning",
    delay: 560,
  },
  {
    text: "guest session detected — access restricted.",
    tone: "accent",
    delay: 480,
  },
  {
    text: "run: activate --account google  (unlocks android build)",
    tone: "command",
    delay: 520,
  },
];

/* ==========================================================================
   HERO
   ========================================================================== */

const EASE_CYBER = [0.22, 1, 0.36, 1] as const;

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 28, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: EASE_CYBER },
  },
};

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section
      id="hero"
      className="relative isolate overflow-hidden pt-28 sm:pt-32 lg:pt-36"
      aria-labelledby="hero-title"
    >
      <div className="container relative pb-20 sm:pb-24 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* ================= left: copy ================= */}
          <motion.div
            variants={reduce ? undefined : containerVariants}
            initial={reduce ? undefined : "hidden"}
            animate={reduce ? undefined : "visible"}
            className="flex flex-col items-start"
          >
            {/* status chip */}
            <motion.div variants={reduce ? undefined : itemVariants}>
              <div
                className={cn(
                  "group inline-flex items-center gap-2.5 rounded-full border border-red-500/30",
                  "bg-red-500/[0.06] py-1.5 pl-2 pr-4 backdrop-blur",
                  "shadow-[0_0_20px_rgba(239,68,68,0.18)]",
                )}
              >
                <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20">
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">
                  Registration gate active
                </span>
              </div>
            </motion.div>

            {/* headline */}
            <motion.h1
              id="hero-title"
              variants={reduce ? undefined : itemVariants}
              className={cn(
                "mt-7 max-w-2xl text-balance font-display",
                "text-[2.1rem] font-extrabold leading-[1.06] tracking-tight text-white",
                "sm:text-5xl lg:text-[3.6rem]",
              )}
            >
              Next Generation{" "}
              <span className="relative inline-block">
                <span className="text-gradient-fire motion-safe:animate-text-shimmer bg-[length:200%_auto]">
                  Cricket Prediction
                </span>
                <motion.span
                  aria-hidden="true"
                  className="absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-red-600 via-red-400 to-transparent shadow-[0_0_14px_rgba(239,68,68,0.8)]"
                  initial={reduce ? undefined : { scaleX: 0 }}
                  animate={reduce ? undefined : { scaleX: 1 }}
                  transition={{ delay: 0.9, duration: 0.8, ease: EASE_CYBER }}
                />
              </span>{" "}
              <GlitchText text="Community" className="text-white" />
            </motion.h1>

            {/* subtitle */}
            <motion.p
              variants={reduce ? undefined : itemVariants}
              className="mt-7 max-w-xl text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg"
            >
              {siteConfig.tagline === "Next Generation Cricket Prediction Community"
                ? "Register your account and unlock application access."
                : siteConfig.tagline}
              <span className="mt-3 block text-[15px] text-zinc-500">
                A private network of analysts, models and match-day signals —
                gated behind a single Google sign-in.
              </span>
            </motion.p>

            {/* CTAs */}
            <motion.div
              variants={reduce ? undefined : itemVariants}
              className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4"
            >
              <Link href="/register" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="default"
                  className="group w-full sm:w-auto"
                >
                  <ShieldCheck aria-hidden="true" />
                  Activate Account
                  <ArrowRight
                    className="transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Button>
              </Link>

              <Link href="#features" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="cyber"
                  className="group w-full sm:w-auto"
                >
                  <Play
                    className="transition-colors group-hover:text-red-400"
                    aria-hidden="true"
                  />
                  Learn More
                </Button>
              </Link>
            </motion.div>

            {/* trust row */}
            <motion.div
              variants={reduce ? undefined : itemVariants}
              className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3"
            >
              {[
                { icon: Zap, label: "10-second setup" },
                { icon: Smartphone, label: "Android 8.0+" },
                { icon: Sparkles, label: "Free forever" },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500"
                >
                  <Icon className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
                  {label}
                </span>
              ))}
            </motion.div>

            {/* stats */}
            <motion.dl
              variants={reduce ? undefined : itemVariants}
              className="mt-12 grid w-full grid-cols-2 gap-x-6 gap-y-5 border-t border-white/[0.07] pt-8 sm:grid-cols-4"
            >
              {stats.map(({ label, value, icon: Icon }) => (
                <div key={label} className="group">
                  <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                    <Icon
                      className="h-3 w-3 text-red-500/60 transition-colors group-hover:text-red-400"
                      aria-hidden="true"
                    />
                    {label}
                  </dt>
                  <dd className="mt-1.5 font-display text-xl font-bold text-white transition-[text-shadow] duration-300 group-hover:[text-shadow:0_0_14px_rgba(239,68,68,0.7)] sm:text-2xl">
                    {value}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </motion.div>

          {/* ================= right: terminal ================= */}
          <motion.div
            initial={reduce ? undefined : { opacity: 0, x: 44, scale: 0.96 }}
            animate={reduce ? undefined : { opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.35, ease: EASE_CYBER }}
            className="relative"
          >
            {/* glow bed */}
            <div
              aria-hidden="true"
              className="absolute -inset-6 rounded-[2rem] bg-red-600/[0.09] blur-[70px]"
            />

            <div className="relative">
              {/* floating badge */}
              <motion.div
                className="absolute -top-4 right-4 z-20 sm:right-8"
                animate={reduce ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <Badge variant="solid" className="shadow-neon">
                  <Zap aria-hidden="true" />
                  Live build v{siteConfig.appVersion}
                </Badge>
              </motion.div>

              <TerminalWindow
                lines={BOOT_LOG}
                title="guest@cricket-prediction:~$ ./access"
                className="relative shadow-[0_0_60px_-12px_rgba(239,68,68,0.34)]"
              />

              {/* corner ticks */}
              <span
                aria-hidden="true"
                className="absolute -left-2 -top-2 h-5 w-5 border-l-2 border-t-2 border-red-500/60"
              />
              <span
                aria-hidden="true"
                className="absolute -bottom-2 -right-2 h-5 w-5 border-b-2 border-r-2 border-red-500/60"
              />
            </div>

            {/* meta row under the terminal */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { k: "Uptime", v: "99.98%" },
                { k: "Avg latency", v: "42 ms" },
                { k: "Build", v: "#1042" },
              ].map(({ k, v }) => (
                <div
                  key={k}
                  className="rounded-md border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 backdrop-blur transition-colors hover:border-red-500/35"
                >
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                    {k}
                  </p>
                  <p className="mt-1 font-mono text-xs font-semibold text-zinc-200">
                    {v}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ================= scroll cue ================= */}
        <motion.div
          initial={reduce ? undefined : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          transition={{ delay: 1.6, duration: 0.8 }}
          className="mt-16 hidden justify-center lg:flex"
        >
          <a
            href="#features"
            className="group flex flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600 transition-colors hover:text-red-400"
          >
            Scroll to explore
            <ChevronDown
              className="h-4 w-4 animate-float"
              aria-hidden="true"
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

export default Hero;
