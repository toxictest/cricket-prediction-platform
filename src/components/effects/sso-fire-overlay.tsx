"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Flame, Lock, Radio, ShieldCheck, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { GoogleMark } from "@/components/auth/google-mark";
import { FireParticleCanvas } from "@/components/effects/fire-particle-canvas";

/* ==========================================================================
   SHARED CONTRACT
   --------------------------------------------------------------------------
   These values are imported by the forms that open the overlay AND by the
   arrival burst on /dashboard, so the two halves of the handshake cannot drift
   apart. Keep them here rather than in each consumer.
   ========================================================================== */

/** sessionStorage flag written before the browser leaves for Google. */
export const SSO_TRANSIT_KEY = "cpc:sso:transit";

/** The line-by-line transit log. The final entry is the terminal state. */
export const SSO_STEPS = [
  "INITIATING OAUTH 2.0 HANDSHAKE",
  "RESOLVING ACCOUNTS.GOOGLE.COM",
  "EXCHANGING AUTHORIZATION CODE",
  "VERIFYING ID TOKEN SIGNATURE",
  "PROVISIONING MEMBER RECORD",
  "ACCESS GRANTED",
] as const;

/** Milliseconds between log lines. */
export const SSO_STEP_MS = 300;

/**
 * How long the browser is held on the overlay before the hard redirect to
 * Google. This is deliberately not zero: the handshake is a real state change
 * and giving it a beat makes the redirect feel like a deliberate operation
 * rather than a flash of unstyled error page.
 */
export const SSO_HOLD_MS = SSO_STEPS.length * SSO_STEP_MS + 260;

/* ==========================================================================
   COMPONENT
   ========================================================================== */

export type SsoFireOverlayProps = {
  open: boolean;
  /** Overrides `SSO_STEPS` when a caller wants a different narrative. */
  steps?: readonly string[];
  stepMs?: number;
  /** Set false for the arrival burst, where there is no outbound redirect. */
  showProgress?: boolean;
  /** Shown under the log, e.g. the destination host. */
  caption?: string;
};

/**
 * SsoFireOverlay
 * ──────────────
 * Full-screen transit effect played while the browser performs the Google
 * OAuth round-trip.
 *
 * Rendering notes:
 *  • Portalled to `document.body`. This is REQUIRED, not stylistic: the overlay
 *    is rendered inside the auth card, and that card carries `.glass-strong`
 *    (`backdrop-filter`). Any non-`none` backdrop-filter makes an element the
 *    containing block for `position: fixed` descendants, so a plain
 *    `fixed inset-0` would be clamped to the card's box instead of the
 *    viewport — the overlay appeared squashed into the form and clipped by the
 *    card's `overflow-hidden`. A portal escapes that containing block.
 *  • Mounted through `AnimatePresence`, so it fades cleanly even if the caller
 *    tears it down early (failed handshake, watchdog timeout).
 *  • Body scroll is locked for the duration and unconditionally restored on
 *    unmount — an overlay that leaks `overflow: hidden` bricks the page behind
 *    it, which is the classic way this pattern breaks.
 *  • The particle canvas already honours `prefers-reduced-motion` and pauses
 *    itself when the tab is hidden; nothing extra is required here.
 *  • `aria-live="polite"` announces the log one line at a time so the effect
 *    is legible to a screen reader instead of being pure decoration.
 */
export function SsoFireOverlay({
  open,
  steps = SSO_STEPS,
  stepMs = SSO_STEP_MS,
  showProgress = true,
  caption,
}: SsoFireOverlayProps) {
  const prefersReducedMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);
  // `document` does not exist during SSR, so the portal can only be created
  // after the first client commit.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /* ---- advance the log one line at a time ---- */
  useEffect(() => {
    if (!open) {
      setActiveStep(0);
      return;
    }

    const timers = steps.map((_, index) =>
      window.setTimeout(() => setActiveStep(index), index * stepMs),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [open, steps, stepMs]);

  /* ---- lock the page behind the overlay ---- */
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const done = activeStep >= steps.length - 1;
  const progress = (activeStep + 1) / steps.length;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="sso-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden px-5"
          // Interactivity is intentionally swallowed: the handshake is in
          // flight and a second click would start a competing flow.
          role="dialog"
          aria-modal="true"
          aria-label="Completing Google sign-in"
        >
          {/* ============ layer 1: backdrop ============ */}
          <div className="absolute inset-0 bg-[#09090b]/94 backdrop-blur-xl" />

          {/* ============ layer 2: fire ============ */}
          <FireParticleCanvas density={300} intensity={2} className="opacity-95" />

          {/* ============ layer 3: cyber grid ============ */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(239,68,68,0.34) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.34) 1px, transparent 1px)",
              backgroundSize: "58px 58px",
              maskImage:
                "radial-gradient(ellipse 70% 60% at 50% 55%, #000 30%, transparent 78%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 60% at 50% 55%, #000 30%, transparent 78%)",
            }}
          />

          {/* ============ layer 4: floor flare + shockwaves ============ */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
            style={{
              background:
                "radial-gradient(ellipse 80% 100% at 50% 100%, rgba(239,68,68,0.34), rgba(249,115,22,0.12) 45%, transparent 72%)",
            }}
          />

          {!prefersReducedMotion &&
            [0, 1, 2].map((ring) => (
              <motion.span
                key={ring}
                aria-hidden="true"
                className="pointer-events-none absolute h-[26rem] w-[26rem] rounded-full border border-red-500/30"
                initial={{ scale: 0.2, opacity: 0.55 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  delay: ring * 0.85,
                  ease: "easeOut",
                }}
              />
            ))}

          {/* ============ layer 5: the handshake card ============ */}
          <motion.div
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg"
          >
            {/* halo behind the card */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute -inset-6 rounded-[2rem] blur-[64px] transition-colors duration-700",
                done ? "bg-emerald-500/[0.16]" : "bg-red-600/[0.20]",
              )}
            />

            <div className="glass-strong neon-border corner-brackets relative overflow-hidden rounded-xl p-6 sm:p-8">
              {/* ---- header ---- */}
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
                <span className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-300">
                  <Flame
                    className="h-3.5 w-3.5 text-red-400"
                    aria-hidden="true"
                  />
                  {done ? "channel open" : "secure transit"}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-red-400/90">
                  <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
                  live
                </span>
              </div>

              {/* ---- node link ---- */}
              <div className="mt-7 flex items-center justify-center gap-4 sm:gap-6">
                {/* local terminal */}
                <div className="relative">
                  <motion.div
                    animate={
                      prefersReducedMotion
                        ? undefined
                        : { boxShadow: [
                            "0 0 18px rgba(239,68,68,0.35)",
                            "0 0 40px rgba(239,68,68,0.75)",
                            "0 0 18px rgba(239,68,68,0.35)",
                          ] }
                    }
                    transition={{ duration: 1.6, repeat: Infinity }}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-red-500/45 bg-red-500/[0.09] sm:h-16 sm:w-16"
                  >
                    <Terminal
                      className="h-6 w-6 text-red-400 sm:h-7 sm:w-7"
                      aria-hidden="true"
                    />
                  </motion.div>
                  <p className="mt-2.5 text-center font-mono text-[8.5px] uppercase tracking-[0.16em] text-zinc-500">
                    this device
                  </p>
                </div>

                {/* beam */}
                <div className="relative h-10 flex-1 sm:h-12">
                  <div
                    aria-hidden="true"
                    className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-red-500/70 via-red-500/25 to-white/25"
                  />

                  {/* travelling packets */}
                  {!prefersReducedMotion &&
                    [0, 1, 2, 3].map((packet) => (
                      <motion.span
                        key={packet}
                        aria-hidden="true"
                        className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-red-400"
                        style={{ boxShadow: "0 0 12px 3px rgba(239,68,68,0.85)" }}
                        initial={{ left: "0%", opacity: 0 }}
                        animate={{
                          left: ["0%", "100%"],
                          opacity: [0, 1, 1, 0],
                        }}
                        transition={{
                          duration: 1.15,
                          repeat: Infinity,
                          ease: "linear",
                          delay: packet * 0.29,
                        }}
                      />
                    ))}

                  {/* success flare along the whole beam */}
                  <motion.div
                    aria-hidden="true"
                    className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-red-500 via-orange-400 to-emerald-400"
                    initial={{ opacity: 0, scaleX: 0.2 }}
                    animate={{ opacity: done ? 0.95 : 0, scaleX: done ? 1 : 0.2 }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                  />

                  <span className="absolute inset-x-0 top-1/2 mt-4 text-center font-mono text-[8.5px] uppercase tracking-[0.18em] text-zinc-500">
                    tls 1.3 · oauth 2.0
                  </span>
                </div>

                {/* google */}
                <div className="relative">
                  <motion.div
                    animate={
                      prefersReducedMotion
                        ? undefined
                        : { boxShadow: [
                            "0 0 18px rgba(255,255,255,0.14)",
                            "0 0 34px rgba(255,255,255,0.30)",
                            "0 0 18px rgba(255,255,255,0.14)",
                          ] }
                    }
                    transition={{ duration: 1.6, repeat: Infinity, delay: 0.4 }}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-white/[0.06] sm:h-16 sm:w-16"
                  >
                    <GoogleMark className="h-6 w-6 sm:h-7 sm:w-7" />
                  </motion.div>
                  <p className="mt-2.5 text-center font-mono text-[8.5px] uppercase tracking-[0.16em] text-zinc-500">
                    identity
                  </p>
                </div>
              </div>

              {/* ---- transit log ---- */}
              <div
                aria-live="polite"
                className="mt-7 space-y-1.5 rounded-md border border-white/[0.07] bg-black/45 p-4"
              >
                {steps.map((line, index) => {
                  const revealed = index <= activeStep;
                  const isLast = index === steps.length - 1;

                  return (
                    <motion.p
                      key={line}
                      initial={false}
                      animate={{ opacity: revealed ? 1 : 0.16 }}
                      transition={{ duration: 0.22 }}
                      className={cn(
                        "flex items-center gap-2 font-mono text-[10.5px] tracking-wide sm:text-[11px]",
                        !revealed && "text-zinc-700",
                        revealed && isLast && "text-emerald-400",
                        revealed && !isLast && "text-zinc-300",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0",
                          revealed && isLast
                            ? "text-emerald-500"
                            : "text-red-500/80",
                        )}
                      >
                        {revealed ? "›" : "·"}
                      </span>
                      <span className="truncate">{line}</span>
                      {revealed && !isLast && (
                        <span className="ml-auto shrink-0 text-[9px] text-zinc-600">
                          ok
                        </span>
                      )}
                    </motion.p>
                  );
                })}
              </div>

              {/* ---- progress ---- */}
              {showProgress && (
                <div className="mt-5">
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        done
                          ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                          : "bg-gradient-to-r from-red-600 via-red-500 to-orange-400",
                      )}
                      animate={{ width: `${progress * 100}%` }}
                      transition={{ duration: 0.32, ease: "easeOut" }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      no password ever touches this server
                    </span>
                    <span className="font-mono text-[9px] tabular-nums tracking-[0.16em] text-zinc-500">
                      {Math.round(progress * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* ---- caption ---- */}
              {caption && (
                <p className="mt-4 flex items-center justify-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  {caption}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default SsoFireOverlay;
