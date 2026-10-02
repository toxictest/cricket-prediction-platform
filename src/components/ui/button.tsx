import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Button
 * ──────
 * Cyberpunk-tuned shadcn primitive. Adds a `cyber` variant (glass surface with
 * a hard neon border) and a `loading` prop that swaps the leading icon for a
 * spinner while preserving the label, so the control never changes width.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-mono text-sm font-semibold uppercase tracking-wider",
    "transition-all duration-300 ease-cyber",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-gradient-to-b from-red-500 to-red-600 text-white",
          "border border-red-400/40",
          "shadow-[0_0_14px_rgba(239,68,68,0.45),inset_0_1px_0_rgba(255,255,255,0.18)]",
          "hover:from-red-400 hover:to-red-500",
          "hover:shadow-[0_0_28px_rgba(239,68,68,0.75),inset_0_1px_0_rgba(255,255,255,0.25)]",
          "hover:-translate-y-0.5",
          "active:translate-y-0 active:shadow-[0_0_10px_rgba(239,68,68,0.5)]",
        ].join(" "),
        neon: [
          "relative overflow-hidden btn-neon",
          "bg-red-600/10 text-red-300 backdrop-blur",
          "border border-red-500/45",
          "shadow-[0_0_10px_rgba(239,68,68,0.25)]",
          "hover:bg-red-600/20 hover:text-red-100 hover:border-red-400",
          "hover:shadow-[0_0_26px_rgba(239,68,68,0.6)]",
          "hover:-translate-y-0.5",
        ].join(" "),
        cyber: [
          "relative overflow-hidden",
          "bg-white/[0.03] text-zinc-200 backdrop-blur-md",
          "border border-white/10",
          "hover:border-red-500/60 hover:text-white",
          "hover:bg-red-500/[0.07]",
          "hover:shadow-[0_0_22px_rgba(239,68,68,0.4)]",
          "hover:-translate-y-0.5",
        ].join(" "),
        outline: [
          "border border-zinc-700 bg-transparent text-zinc-300",
          "hover:border-red-500/60 hover:text-red-300 hover:bg-red-500/5",
        ].join(" "),
        secondary: [
          "bg-zinc-800 text-zinc-100 border border-zinc-700",
          "hover:bg-zinc-700 hover:border-zinc-600",
        ].join(" "),
        ghost: [
          "text-zinc-400 hover:text-red-300 hover:bg-red-500/10",
        ].join(" "),
        link: [
          "text-red-400 underline-offset-4 normal-case tracking-normal",
          "hover:text-red-300 hover:underline",
        ].join(" "),
        destructive: [
          "bg-red-900/80 text-red-100 border border-red-700",
          "hover:bg-red-800 hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]",
        ].join(" "),
      },
      size: {
        default: "h-11 px-6 py-2 clip-cyber",
        sm: "h-9 px-4 text-xs clip-cyber",
        lg: "h-14 px-9 text-base clip-cyber",
        xl: "h-16 px-10 text-base sm:text-lg clip-cyber",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Show a spinner and disable interaction without changing layout. */
  loading?: boolean;
  /** Label announced to screen readers while `loading` is true. */
  loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText = "Working",
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    // `asChild` hands rendering to the child element, which cannot accept the
    // injected spinner — so children are passed through untouched.
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span>{loadingText}…</span>
            <span className="sr-only">{loadingText}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
