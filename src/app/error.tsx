"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Route-level error boundary.
 *
 * Next.js renders this for any uncaught error thrown while rendering a segment
 * beneath the root layout. The `error.digest` is the server-side correlation id
 * — surfacing it lets a user paste it into a support message and lets us find
 * the matching log line.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with your observability sink (Sentry, Axiom, Datadog…).
    console.error("[route-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main
      id="main"
      className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 py-20"
    >
      <div className="relative w-full max-w-xl text-center">
        <div
          aria-hidden="true"
          className="absolute -inset-8 rounded-3xl bg-red-600/[0.12] blur-[80px]"
        />

        <div className="relative overflow-hidden rounded-lg glass-strong border-red-500/35 p-8 sm:p-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[repeating-linear-gradient(45deg,#ef4444_0,#ef4444_9px,transparent_9px,transparent_18px)] opacity-70"
          />

          <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/[0.08]">
            <AlertOctagon className="h-6 w-6 text-red-400" aria-hidden="true" />
          </div>

          <Badge variant="destructive" className="relative mt-6">
            500 · Runtime fault
          </Badge>

          <h1 className="relative mt-5 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Something <span className="text-gradient-fire">crashed</span>
          </h1>

          <p className="relative mx-auto mt-4 max-w-md text-[14.5px] leading-relaxed text-zinc-400">
            The node threw while rendering this segment. Retrying usually clears
            a transient database or network fault.
          </p>

          {/* diagnostic */}
          <div className="relative mx-auto mt-7 max-w-md rounded-md border border-red-500/25 bg-black/60 p-4 text-left">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-600">
              Diagnostic
            </p>
            <code className="mt-2 block break-words font-mono text-[11px] leading-relaxed text-red-400">
              {error.message || "Unknown error"}
            </code>
            {error.digest && (
              <code className="mt-2 block break-all font-mono text-[10px] leading-relaxed text-zinc-600">
                digest: {error.digest}
              </code>
            )}
          </div>

          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="default" onClick={reset} className="w-full sm:w-auto">
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
            <Link href="/" className="w-full sm:w-auto">
              <Button variant="cyber" className="w-full sm:w-auto">
                <Home aria-hidden="true" />
                Back to home
              </Button>
            </Link>
          </div>

          <p className="relative mt-6 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
            Reference the digest above when contacting support
          </p>
        </div>
      </div>
    </main>
  );
}
