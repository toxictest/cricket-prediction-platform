import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the field in the terminal style: mono font + `$` prompt affordance. */
  terminal?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, terminal = false, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-zinc-950/60 px-3.5 py-2",
        "text-sm text-foreground shadow-inner-line backdrop-blur",
        "transition-all duration-250 ease-cyber",
        "placeholder:text-zinc-600",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "hover:border-zinc-700",
        "focus-visible:outline-none focus-visible:border-red-500/70",
        "focus-visible:ring-1 focus-visible:ring-red-500/40",
        "focus-visible:shadow-[0_0_0_1px_rgba(239,68,68,0.25),0_0_18px_rgba(239,68,68,0.22)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus-visible:ring-red-700/50",
        terminal && "font-mono tracking-wide",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
