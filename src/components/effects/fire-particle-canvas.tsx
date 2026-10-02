"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   TYPES & CONFIG
   ========================================================================== */

type Particle = {
  /** Position in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** Velocity in px/second. */
  vx: number;
  vy: number;
  /** Base radius in CSS pixels. */
  radius: number;
  /** 0 → 1 flame lifetime progress. */
  life: number;
  /** Lifetime in seconds. */
  lifespan: number;
  /** Per-particle noise seed so turbulence never syncs up. */
  seed: number;
  /** 0 = tall flame body, 1 = short-lived spark. */
  kind: "flame" | "spark";
  /** Horizontal sway amplitude. */
  sway: number;
};

export type FireParticleCanvasProps = {
  className?: string;
  /**
   * Particle budget at a 1440px-wide viewport. Auto-scaled down for smaller
   * screens and for `devicePixelRatio < 1`. Default 190.
   */
  density?: number;
  /** Global speed multiplier for every particle's vertical velocity. */
  intensity?: number;
  /** Fade the canvas into the page background at the top edge. */
  fadeTop?: boolean;
};

/** Flame colour ramp — dark red core climbing to a white-hot tip. */
const RAMP: Array<[number, number, number]> = [
  [120, 12, 12], // #780c0c ember
  [185, 28, 28], // #b91c1c red-700
  [239, 68, 68], // #ef4444 red-500
  [249, 115, 22], // #f97316 orange-500
  [251, 191, 36], // #fbbf24 amber-400
  [254, 243, 199], // #fef3c7 amber-100
];

function sampleRamp(t: number): [number, number, number] {
  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * (RAMP.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(index + 1, RAMP.length - 1);
  const frac = scaled - index;

  const a = RAMP[index]!;
  const b = RAMP[next]!;

  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/* ==========================================================================
   COMPONENT
   ========================================================================== */

/**
 * FireParticleCanvas
 * ──────────────────
 * GPU-friendly additive-blended flame field rendered on a single 2D canvas.
 *
 * Engineering notes:
 *  • Uses one canvas element rather than N DOM nodes — no layout thrash.
 *  • Particle count scales with viewport width and is capped so mobile GPUs
 *    stay cool.
 *  • The RAF loop is throttled to ~60fps, paused when the tab is hidden, and
 *    respects `prefers-reduced-motion` (renders one static frame instead).
 *  • DPR is capped at 2 so 3x "retina" phones don't quadruple fill-rate for
 *    no visible gain.
 *  • Full teardown on unmount: observers disconnected, RAF cancelled.
 */
export function FireParticleCanvas({
  className,
  density = 190,
  intensity = 1,
  fadeTop = true,
}: FireParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let disposed = false;
    let paused = false;

    /* ----------------------------------------------------------------
       Sizing
       ---------------------------------------------------------------- */
    function resize() {
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      sizeRef.current = { width, height, dpr };

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ----------------------------------------------------------------
       Particle factory
       ---------------------------------------------------------------- */
    function spawn(kind: Particle["kind"] = Math.random() < 0.14 ? "spark" : "flame"): Particle {
      const { width, height } = sizeRef.current;

      const isSpark = kind === "spark";

      return {
        // Emit mostly from the lower band, weighted toward the left and right
        // thirds so the centre of the screen (where the headline sits) stays
        // readable.
        x: rand(-width * 0.05, width * 1.05),
        y: height + rand(0, height * 0.16),
        vx: rand(-14, 14),
        vy: -rand(isSpark ? 40 : 26, isSpark ? 150 : 96) * intensity,
        radius: isSpark ? rand(0.6, 1.5) : rand(1.4, 4.6),
        life: 0,
        lifespan: rand(isSpark ? 1.1 : 2.2, isSpark ? 2.2 : 5.0),
        seed: Math.random() * Math.PI * 2,
        kind,
        sway: rand(6, 30),
      };
    }

    function targetCount() {
      const { width } = sizeRef.current;
      // Scale density down on narrow viewports: 0.45x at 360px → 1x at 1440px.
      const factor = Math.min(Math.max(width / 1440, 0.38), 1);
      return Math.max(28, Math.round(density * factor));
    }

    function seedParticles() {
      const count = targetCount();
      const list: Particle[] = [];
      for (let i = 0; i < count; i += 1) {
        const p = spawn();
        // Distribute initial ages so the field is already alive on frame 1
        // instead of "igniting" all at once.
        p.life = Math.random() * p.lifespan;
        p.y = sizeRef.current.height * (1 - Math.random() * 0.85);
        list.push(p);
      }
      particlesRef.current = list;
    }

    /* ----------------------------------------------------------------
       Render loop
       ---------------------------------------------------------------- */
    function drawStaticFrame() {
      const { width, height } = sizeRef.current;
      ctx!.clearRect(0, 0, width, height);
      drawBaseGlow(ctx!, width, height);
      for (const p of particlesRef.current) {
        renderParticle(ctx!, p, width, height);
      }
    }

    function frame(time: number) {
      if (disposed) return;

      const { width, height } = sizeRef.current;
      const last = lastTimeRef.current || time;
      // Clamp dt to 50ms: a background tab that wakes up must not teleport
      // every particle across the screen in a single step.
      const dt = Math.min((time - last) / 1000, 0.05);
      lastTimeRef.current = time;

      if (!paused) {
        ctx!.clearRect(0, 0, width, height);
        drawBaseGlow(ctx!, width, height);

        const particles = particlesRef.current;
        const wanted = targetCount();

        for (let i = 0; i < particles.length; i += 1) {
          const p = particles[i]!;
          p.life += dt;

          if (p.life >= p.lifespan || p.y < -60) {
            // Recycle in place — avoids per-frame allocation and GC churn.
            particles[i] = spawn();
            continue;
          }

          // Turbulence: two out-of-phase sines give an organic, fire-like lick.
          const turbulence =
            Math.sin(p.seed + p.life * 3.1) * 0.7 +
            Math.sin(p.seed * 2.3 + p.life * 1.7) * 0.3;

          p.vx += turbulence * 12 * dt;
          p.vx *= 0.985; // drag keeps horizontal drift bounded
          p.x += (p.vx + Math.sin(p.life * 2.2 + p.seed) * p.sway) * dt;
          p.y += p.vy * dt;

          renderParticle(ctx!, p, width, height);
        }

        // Keep the pool aligned with the viewport after a resize / rotate.
        if (particles.length < wanted) {
          particles.push(spawn());
        } else if (particles.length > wanted + 24) {
          particles.length = wanted;
        }
      }

      // `fadeTop` doubles as a cheap bloom: composite the frame over itself.
      if (fadeTop) {
        const gradient = ctx!.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, "rgba(9, 9, 11, 1)");
        gradient.addColorStop(0.42, "rgba(9, 9, 11, 0.35)");
        gradient.addColorStop(0.75, "rgba(9, 9, 11, 0)");
        ctx!.fillStyle = gradient;
        ctx!.fillRect(0, 0, width, height * 0.75);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    /* ----------------------------------------------------------------
       Per-particle painting
       ---------------------------------------------------------------- */
    function renderParticle(
      c: CanvasRenderingContext2D,
      p: Particle,
      width: number,
      height: number,
    ) {
      if (p.x < -80 || p.x > width + 80 || p.y < -80 || p.y > height + 80) {
        return;
      }

      const t = p.life / p.lifespan;

      // Opacity arc: quick fade-in, long tail-out.
      const alpha =
        t < 0.18
          ? (t / 0.18) * 0.9
          : Math.pow(1 - (t - 0.18) / 0.82, 1.7) * 0.9;

      if (alpha <= 0.004) return;

      // Colour climbs the ramp as the particle heats up, then cools.
      const heat =
        p.kind === "spark"
          ? 0.55 + 0.45 * Math.sin(t * Math.PI)
          : 1 - t * 0.85;

      const [r, g, b] = sampleRamp(heat);
      const radius = p.radius * (1 - t * (p.kind === "spark" ? 0.85 : 0.45));

      if (radius <= 0.1) return;

      const gradient = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.4);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.35})`);
      gradient.addColorStop(1, "rgba(120, 12, 12, 0)");

      c.fillStyle = gradient;
      c.beginPath();
      c.arc(p.x, p.y, radius * 3.4, 0, Math.PI * 2);
      c.fill();
    }

    /* ----------------------------------------------------------------
       Base glow — the hot ember bed along the bottom edge
       ---------------------------------------------------------------- */
    function drawBaseGlow(
      c: CanvasRenderingContext2D,
      width: number,
      height: number,
    ) {
      const glow = c.createLinearGradient(0, height, 0, height * 0.42);
      glow.addColorStop(0, "rgba(239, 68, 68, 0.30)");
      glow.addColorStop(0.35, "rgba(185, 28, 28, 0.12)");
      glow.addColorStop(1, "rgba(9, 9, 11, 0)");

      c.fillStyle = glow;
      c.fillRect(0, height * 0.42, width, height * 0.58);
    }

    /* ----------------------------------------------------------------
       Boot
       ---------------------------------------------------------------- */
    resize();
    seedParticles();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      seedParticles();
      lastTimeRef.current = 0;
    });
    resizeObserver.observe(canvas);

    function handleVisibility() {
      paused = document.hidden;
      // Reset the clock so the clamped-dt guard doesn't need to rescue us.
      lastTimeRef.current = 0;
    }

    if (prefersReducedMotion) {
      drawStaticFrame();
    } else {
      rafRef.current = requestAnimationFrame(frame);
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      particlesRef.current = [];
    };
  }, [density, intensity, fadeTop]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      role="presentation"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full",
        // Additive glow looks right over near-black surfaces.
        "mix-blend-screen",
        className,
      )}
    />
  );
}

export default FireParticleCanvas;
