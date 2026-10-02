import Link from "next/link";
import { ArrowRight, Lock, ShieldAlert, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * AccessNotice
 * ────────────
 * Shown on the auth screens when the middleware bounced the visitor away from
 * a gated route.
 *
 * Because `src/middleware.ts` protects `/download` and `/dashboard` at the
 * edge, a guest who taps "Download" is redirected to
 * `/login?callbackUrl=/download`. This banner preserves the blocked resource
 * in context, states the reason in the exact product copy ("Access Restricted"
 * / "Please activate your account first.") and routes them to `/register`.
 *
 * The Download Center page renders the same copy through
 * `<AccessRestricted />` for the defence-in-depth path.
 */
export function AccessNotice({
  requestedPath,
  className,
}: {
  /** The gated route the visitor originally asked for. */
  requestedPath: string;
  className?: string;
}) {
  const label =
    requestedPath === "/download"
      ? "Download Center"
      : requestedPath === "/dashboard"
        ? "Dashboard"
        : requestedPath;

  return (
    <div
      role="alert"
      aria-labelledby="access-notice-title"
      className={cn(
        "relative overflow-hidden rounded-md border border-red-500/35 bg-red-500/[0.06] p-5",
        "shadow-[0_0_28px_-8px_rgba(239,68,68,0.4)]",
        className,
      )}
    >
      {/* hazard rail */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[repeating-linear-gradient(45deg,#ef4444_0,#ef4444_8px,transparent_8px,transparent_16px)] opacity-60"
      />

      <div className="flex items-start gap-3.5 pt-1">
        <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10">
          <ShieldAlert className="h-5 w-5 text-red-400" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="access-notice-title"
              className="font-display text-[15px] font-bold text-white"
            >
              Access Restricted
            </h2>
            <Badge variant="destructive">
              <Lock aria-hidden="true" />
              403
            </Badge>
          </div>

          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-400">
            Please activate your account first.
          </p>

          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-500/70">
            gated route: {requestedPath} · {label}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Link href="/register">
              <Button size="sm" variant="default" className="group">
                <Smartphone aria-hidden="true" />
                Activate Account
                <ArrowRight
                  className="transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Button>
            </Link>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
              or sign in below
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccessNotice;
