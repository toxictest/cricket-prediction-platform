import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Uses a red-tinted shimmer so skeleton states stay
 * on-theme instead of the default neutral pulse.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-zinc-900/80",
        "after:absolute after:inset-0 after:animate-sweep-x",
        "after:bg-gradient-to-r after:from-transparent after:via-red-500/[0.14] after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
