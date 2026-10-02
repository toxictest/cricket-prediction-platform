"use client";

import { createElement, type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

/* ==========================================================================
   MOTION PRESETS
   ========================================================================== */

const EASE_CYBER = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.65, ease: EASE_CYBER },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.7, ease: EASE_CYBER } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.55, ease: EASE_CYBER },
  },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -34 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: EASE_CYBER },
  },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 34 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE_CYBER } },
};

/* ==========================================================================
   REVEAL
   ========================================================================== */

/**
 * Scroll-triggered entrance wrapper.
 *
 * Fires once, slightly before the element is fully in view (`margin: -60px`)
 * so content is already settled by the time the user reads it. With
 * `prefers-reduced-motion` the children render immediately with no transform.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  duration,
  as = "div",
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "up" | "in" | "scale" | "left" | "right";
  duration?: number;
  as?: "div" | "section" | "li" | "span";
  once?: boolean;
}) {
  const reduce = useReducedMotion();

  const variantMap: Record<typeof variant, Variants> = {
    up: fadeUp,
    in: fadeIn,
    scale: scaleIn,
    left: slideInLeft,
    right: slideInRight,
  };

  if (reduce) {
    return createElement(as, { className }, children);
  }

  const MotionTag = motion[as] as typeof motion.div;

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-60px" }}
      variants={variantMap[variant]}
      transition={{ delay, ...(duration ? { duration } : {}) }}
    >
      {children}
    </MotionTag>
  );
}

/* ==========================================================================
   STAGGER CONTAINER + ITEM
   ========================================================================== */

export function StaggerGroup({
  children,
  className,
  stagger = 0.09,
  delay = 0,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-60px" }}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  variant = "up",
}: {
  children: ReactNode;
  className?: string;
  variant?: "up" | "in" | "scale" | "left" | "right";
}) {
  const reduce = useReducedMotion();

  const variantMap: Record<typeof variant, Variants> = {
    up: fadeUp,
    in: fadeIn,
    scale: scaleIn,
    left: slideInLeft,
    right: slideInRight,
  };

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div className={className} variants={variantMap[variant]}>
      {children}
    </motion.div>
  );
}

/* ==========================================================================
   TYPEWRITER TEXT
   ========================================================================== */

export function TypewriterText({
  text,
  className,
  speed = 42,
  startDelay = 0,
  showCaret = true,
}: {
  text: string;
  className?: string;
  speed?: number;
  startDelay?: number;
  showCaret?: boolean;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={cn("inline-block", className)}>
      <motion.span
        className="inline"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ delay: startDelay }}
      >
        {text.split("").map((char, index) => (
          <motion.span
            key={`${char}-${index}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              delay: startDelay + (index * speed) / 1000,
              duration: 0.01,
            }}
          >
            {char}
          </motion.span>
        ))}
      </motion.span>
      {showCaret && (
        <motion.span
          className="ml-0.5 inline-block h-[0.85em] w-[0.5ch] translate-y-[0.06em] bg-red-500 align-middle"
          animate={{ opacity: [1, 1, 0, 0] }}
          transition={{
            duration: 1.1,
            times: [0, 0.5, 0.5, 1],
            repeat: Infinity,
          }}
        />
      )}
    </span>
  );
}

/* ==========================================================================
   GLITCH TEXT
   ========================================================================== */

/**
 * CSS-only RGB-split glitch. Runs a few times on mount then settles, matching
 * how a real terminal clears its ghosting.
 */
export function GlitchText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <span className={cn("relative inline-block", className)}>
      <span className="relative z-10">{text}</span>
      {!reduce && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 z-0 select-none text-red-500/70 motion-safe:animate-flicker"
            style={{ transform: "translate(1.5px, -1px)" }}
          >
            {text}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-0 z-0 select-none text-orange-400/40 motion-safe:animate-flicker"
            style={{ transform: "translate(-1.5px, 1px)", animationDelay: "0.35s" }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
