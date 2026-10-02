import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/effects/reveal";

/**
 * Consistent section header used by every landing-page block.
 *
 *   <SectionHeading
 *     eyebrow="01 / Features"
 *     title="Everything the terminal gives you"
 *     description="…"
 *   />
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
  titleClassName,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  className?: string;
  titleClassName?: string;
  children?: ReactNode;
}) {
  const centered = align === "center";

  return (
    <div
      className={cn(
        "flex flex-col",
        centered ? "items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow && (
        <Reveal variant="in">
          <div
            className={cn(
              "mb-5 inline-flex items-center gap-2.5 rounded-sm border border-red-500/30",
              "bg-red-500/[0.07] px-3.5 py-1.5",
              "font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-red-400",
              "shadow-[0_0_16px_rgba(239,68,68,0.16)]",
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
            </span>
            {eyebrow}
          </div>
        </Reveal>
      )}

      <Reveal variant="up" delay={0.06}>
        <h2
          className={cn(
            "max-w-3xl text-balance font-display text-3xl font-bold leading-[1.12] tracking-tight text-white",
            "sm:text-4xl lg:text-[2.75rem]",
            titleClassName,
          )}
        >
          {title}
        </h2>
      </Reveal>

      {description && (
        <Reveal variant="up" delay={0.12}>
          <p
            className={cn(
              "mt-5 max-w-2xl text-pretty text-[15px] leading-relaxed text-zinc-400 sm:text-base",
              centered && "mx-auto",
            )}
          >
            {description}
          </p>
        </Reveal>
      )}

      {children && (
        <Reveal variant="up" delay={0.18}>
          <div className="mt-8">{children}</div>
        </Reveal>
      )}

      <Reveal variant="in" delay={0.2}>
        <div
          className={cn(
            "mt-8 h-px w-40 bg-gradient-to-r",
            centered
              ? "from-transparent via-red-500/50 to-transparent"
              : "from-red-500/60 to-transparent",
          )}
        />
      </Reveal>
    </div>
  );
}

export default SectionHeading;
