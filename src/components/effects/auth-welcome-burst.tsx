"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Flame, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FireParticleCanvas } from "@/components/effects/fire-particle-canvas";
import { SSO_TRANSIT_KEY } from "@/components/effects/sso-fire-overlay";

/** How long the arrival burst stays on screen before unmounting itself. */
const BURST_MS = 2600;

/**
 * AuthWelcomeBurst
 * ────────────────
 * The second half of the Google SSO effect.
 *
 * The outbound half (`SsoFireOverlay`) is unmounted by a full-page navigation
 * to Google — nothing survives it. So the two halves are joined through a
 * one-shot `sessionStorage` flag: the login form sets it immediately before
 * redirecting, and this component consumes it on arrival.
 *
 * `sessionStorage` (rather than `localStorage`) is the right store: it is
 * scoped to a single tab and cleared when that tab closes, so a returning
 * visitor never sees a stale welcome burst, and two tabs cannot consume each
 * other's flag.
 *
 * The flag is removed synchronously on read, so the burst is strictly
 * once-per-handshake — reloading the dashboard does not replay it.
 *
 * Like the outbound overlay, this is portalled to `document.body` so it is
 * positioned against the viewport even if an ancestor introduces a
 * `backdrop-filter` (which would otherwise become its containing block).
 */
export function AuthWelcomeBurst() {
  const prefersReducedMotion = useReducedMotion();
  const [active, setActive] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /*
   * Runs EXACTLY ONCE, deliberately.
   *
   * `useReducedMotion()` returns `null` during the first render and only
   * resolves to a boolean afterwards. Depending on that value here meant the
   * effect re-ran on that transition — the cleanup cleared the dismissal
   * timer, the one-shot sessionStorage flag had already been consumed, and
   * the early return left no timer behind. The burst then stayed on screen
   * forever.
   *
   * Reading the media query imperatively inside the effect removes the
   * reactive dependency entirely, so the flag is consumed and the timer armed
   * in a single, uninterruptible pass. The hook is still used for the
   * declarative animation props below, where a re-render is harmless.
   */
  useEffect(() => {
    let fired = false;

    try {
      fired = window.sessionStorage.getItem(SSO_TRANSIT_KEY) !== null;
      if (fired) window.sessionStorage.removeItem(SSO_TRANSIT_KEY);
    } catch {
      // Storage can throw in private-mode Safari on some versions. A missing
      // celebration is acceptable; a crash on the dashboard is not.
      return;
    }

    if (!fired) return;

    setActive(true);

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () => setActive(false),
      reduced ? 1400 : BURST_MS,
    );

    return () => window.clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          key="welcome-burst"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center overflow-hidden px-5"
          role="status"
          aria-live="polite"
        >
          <div className="absolute inset-0 bg-[#09090b]/80 backdrop-blur-[2px]" />

          {/* the fire that climbs the screen as the session lands */}
          <FireParticleCanvas density={340} intensity={2.3} />

          {/* upward ember column behind the badge */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-3/4"
            style={{
              background:
                "radial-gradient(ellipse 58% 100% at 50% 100%, rgba(251,146,60,0.46), rgba(239,68,68,0.26) 34%, rgba(120,12,12,0.12) 58%, transparent 78%)",
            }}
          />

          {/* expanding ignition ring */}
          {!prefersReducedMotion && (
            <motion.span
              aria-hidden="true"
              className="absolute h-56 w-56 rounded-full border-2 border-emerald-400/40"
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 1.9, ease: "easeOut" }}
            />
          )}

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.97 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div
              aria-hidden="true"
              className="absolute -inset-10 rounded-[2.5rem] bg-red-600/[0.22] blur-[80px]"
            />
            <div
              aria-hidden="true"
              className="absolute -inset-8 rounded-[2.5rem] bg-emerald-500/[0.16] blur-[64px]"
            />

            <div className="glass-strong corner-brackets relative flex flex-col items-center gap-4 rounded-xl border border-emerald-400/25 px-9 py-8 text-center">
              <motion.div
                initial={{ scale: 0.5, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  delay: 0.12,
                  type: "spring",
                  stiffness: 260,
                  damping: 15,
                }}
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl",
                  "border border-emerald-400/40 bg-emerald-500/[0.12]",
                  "shadow-[0_0_44px_rgba(16,185,129,0.45)]",
                )}
              >
                <Unlock
                  className="h-7 w-7 text-emerald-300"
                  aria-hidden="true"
                />
              </motion.div>

              <div className="space-y-1.5">
                <p className="font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                  ACCESS{" "}
                  <span className="text-gradient-fire">GRANTED</span>
                </p>
                <p className="flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  member record synced
                </p>
              </div>

              {!prefersReducedMotion && (
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1 w-6 rounded-full bg-gradient-to-r from-red-500 to-orange-400"
                      animate={{ opacity: [0.25, 1, 0.25] }}
                      transition={{
                        duration: 1.1,
                        repeat: Infinity,
                        delay: i * 0.18,
                      }}
                    />
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                <Flame className="h-3 w-3 text-red-500/70" aria-hidden="true" />
                welcome back, operator
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default AuthWelcomeBurst;
