"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    /** Optional label rendered above the track. */
    label?: string;
    /** Optional value rendered at the right of the label row. */
    valueLabel?: string;
    indicatorClassName?: string;
  }
>(
  (
    { className, value, label, valueLabel, indicatorClassName, ...props },
    ref,
  ) => (
    <div className="w-full space-y-2">
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              {label}
            </span>
          )}
          {valueLabel && (
            <span className="font-mono text-[11px] font-semibold text-red-400">
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <ProgressPrimitive.Root
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full",
          "bg-zinc-900 border border-white/[0.06]",
          className,
        )}
        value={value}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full w-full flex-1 rounded-full transition-transform duration-700 ease-cyber",
            "bg-gradient-to-r from-red-700 via-red-500 to-red-400",
            "shadow-[0_0_12px_rgba(239,68,68,0.65)]",
            indicatorClassName,
          )}
          style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  ),
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
