"use client";

import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { FireParticleCanvas } from "@/components/effects/fire-particle-canvas";

/* ==========================================================================
   CYBER GRID OVERLAY
   ========================================================================== */

export function CyberGrid({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {/* Primary 64px grid */}
      <div
        className={cn(
          "absolute inset-0 cyber-grid-overlay",
          animated && !reduce && "motion-safe:animate-grid-drift",
        )}
        style={{
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse 100% 80% at 50% 30%, black 20%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 100% 80% at 50% 30%, black 20%, transparent 85%)",
        }}
      />

      {/* Offset 16px sub-grid for depth */}
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            "linear-gradient(rgba(239,68,68,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.045) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 60%, black 10%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 60%, black 10%, transparent 80%)",
        }}
      />

      {/* Horizon line — the classic synthwave vanishing point */}
      <div className="absolute left-1/2 top-0 h-px w-[140%] -translate-x-1/2 bg-gradient-to-r from-transparent via-red-500/35 to-transparent" />

      {/* Slow vertical sweep */}
      {!reduce && (
        <div className="absolute inset-x-0 top-0 h-40 animate-scanline bg-gradient-to-b from-transparent via-red-500/[0.055] to-transparent" />
      )}
    </div>
  );
}

/* ==========================================================================
   AMBIENT GLOW ORBS
   ========================================================================== */

export function GlowOrbs({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  const orbs = [
    {
      className:
        "left-[-12%] top-[-8%] h-[38rem] w-[38rem] bg-red-600/[0.13]",
      duration: 16,
    },
    {
      className:
        "right-[-14%] top-[18%] h-[30rem] w-[30rem] bg-red-800/[0.14]",
      duration: 21,
    },
    {
      className:
        "left-[28%] bottom-[-18%] h-[34rem] w-[34rem] bg-orange-700/[0.09]",
      duration: 26,
    },
  ];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {orbs.map((orb, index) => (
        <div
          key={index}
          className={cn(
            "absolute rounded-full blur-[110px]",
            orb.className,
            !reduce && "animate-float-slow",
          )}
          style={{ animationDuration: `${orb.duration}s` }}
        />
      ))}
    </div>
  );
}

/* ==========================================================================
   SCANLINE / VIGNETTE / NOISE
   ========================================================================== */

export function ScanlineOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-10 opacity-[0.55]",
        "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_2px,rgba(0,0,0,0.22)_3px,rgba(0,0,0,0.22)_4px)]",
        className,
      )}
    />
  );
}

export function VignetteOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-10",
        "bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,0.62)_100%)]",
        className,
      )}
    />
  );
}

/**
 * Film grain via an inline SVG feTurbulence data URI — no network request, so
 * it still renders inside a sandboxed iframe preview.
 */
export function NoiseOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-10 opacity-[0.035] mix-blend-overlay",
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }}
    />
  );
}

/* ==========================================================================
   COMPOSED FULL-PAGE BACKGROUND
   ========================================================================== */

export type CyberBackgroundProps = {
  /** Render the animated fire particle canvas. */
  fire?: boolean;
  grid?: boolean;
  orbs?: boolean;
  scanlines?: boolean;
  vignette?: boolean;
  noise?: boolean;
  /** Canvas particle budget — lower it for content-heavy inner pages. */
  density?: number;
  className?: string;
};

/**
 * Layered page backdrop. Ordering matters: grid → orbs → fire → grain →
 * scanlines → vignette, so the fire reads as *behind* the glass UI while the
 * vignette pulls focus to the centre.
 */
export function CyberBackground({
  fire = true,
  grid = true,
  orbs = true,
  scanlines = true,
  vignette = true,
  noise = true,
  density = 190,
  className,
}: CyberBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#09090b]",
        className,
      )}
    >
      {grid && <CyberGrid />}
      {orbs && <GlowOrbs />}
      {fire && <FireParticleCanvas density={density} fadeTop />}
      {noise && <NoiseOverlay />}
      {scanlines && <ScanlineOverlay />}
      {vignette && <VignetteOverlay />}
    </div>
  );
}
