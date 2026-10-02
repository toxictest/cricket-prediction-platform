import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5",
    "font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
    "transition-colors duration-200",
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    "[&_svg]:size-3 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-red-500/40 bg-red-500/12 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.22)]",
        neon: "border-red-400/60 bg-red-500/20 text-red-200 shadow-[0_0_14px_rgba(239,68,68,0.4)]",
        solid: "border-red-500 bg-red-600 text-white shadow-neon-sm",
        secondary: "border-zinc-700 bg-zinc-800/70 text-zinc-300",
        outline: "border-white/15 bg-transparent text-zinc-400",
        success:
          "border-emerald-500/40 bg-emerald-500/12 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
        warning:
          "border-amber-500/40 bg-amber-500/12 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]",
        info: "border-cyan-500/40 bg-cyan-500/12 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]",
        destructive:
          "border-red-700 bg-red-950/70 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.25)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
