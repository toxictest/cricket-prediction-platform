"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Lock,
  LogIn,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * AccessRestricted
 * ────────────────
 * Rendered whenever an unauthenticated visitor reaches the Download Center.
 *
 * In normal operation `src/middleware.ts` intercepts first and issues a 307 to
 * `/login?callbackUrl=/download`, so this screen is the defence-in-depth path:
 * it covers sessions that expire between the middleware check and the render,
 * tokens whose database row was deleted, and any deployment where the edge
 * matcher has been narrowed.
 *
 * The gate is never cosmetic — `/api/download` independently verifies the
 * session on the server before a single byte of the APK is streamed.
 */
export function AccessRestricted({
  className,
  /** Why access was refused, used to pick the right copy. */
  reason = "unauthenticated",
}: {
  className?: string;
  reason?: "unauthenticated" | "no-member-record";
}) {
  const reduce = useReducedMotion();

  const isDeleted = reason === "no-member-record";

  return (
    <div
      className={cn("container flex items-center justify-center py-16 sm:py-20", className)}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 26, scale: 0.97 }}
        animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-2xl"
      >
        {/* glow bed */}
        <div
          aria-hidden="true"
          className="absolute -inset-6 rounded-3xl bg-red-600/[0.12] blur-[70px]"
        />

        <div
          role="alert"
          aria-labelledby="restricted-title"
          className={cn(
            "relative overflow-hidden rounded-lg p-7 text-center sm:p-10",
            "glass-strong border-red-500/35",
          )}
          style={{
            boxShadow:
              "0 0 70px -18px rgba(239,68,68,0.45), inset 0 1px 0 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* hazard stripes */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(45deg,#ef4444_0,#ef4444_10px,transparent_10px,transparent_20px)] opacity-70"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 cyber-grid-overlay opacity-30 mask-fade-y"
          />

          {/* icon */}
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-pulse-glow rounded-lg"
            />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-red-500/45 bg-red-500/[0.08]">
              <ShieldAlert className="h-7 w-7 text-red-400" aria-hidden="true" />
            </span>
          </div>

          <Badge variant="destructive" className="relative mt-6">
            <Lock aria-hidden="true" />
            403 · Gated resource
          </Badge>

          <h1
            id="restricted-title"
            className="relative mt-5 font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl"
          >
            Access Restricted
          </h1>

          <p className="relative mx-auto mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-zinc-400">
            {isDeleted
              ? "Your session is valid but the member record it points to no longer exists. Re-activate your account to restore download access."
              : "Please activate your account first."}
          </p>

          {/* terminal block */}
          <div className="relative mx-auto mt-7 max-w-md overflow-hidden rounded-md border border-red-500/25 bg-black/60 p-4 text-left">
            <code className="block font-mono text-[11.5px] leading-relaxed text-zinc-400">
              <span className="text-red-500">$</span> curl -I /api/download
            </code>
            <code className="mt-1.5 block font-mono text-[11.5px] leading-relaxed text-red-400">
              HTTP/1.1 401 Unauthorized
            </code>
            <code className="mt-1.5 block font-mono text-[11.5px] leading-relaxed text-zinc-500">
              {`{ "ok": false, "code": "UNAUTHORIZED" }`}
            </code>
          </div>

          {/* actions */}
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link href="/register" className="w-full sm:w-auto">
              <Button size="lg" variant="default" className="group w-full sm:w-auto">
                <Smartphone aria-hidden="true" />
                Activate Account
                <ArrowRight
                  className="transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Button>
            </Link>

            <Link href="/login" className="w-full sm:w-auto">
              <Button size="lg" variant="cyber" className="w-full sm:w-auto">
                <LogIn aria-hidden="true" />
                Sign In
              </Button>
            </Link>
          </div>

          <p className="relative mt-7 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
            Registration takes ~10 seconds · Google sign-in only
          </p>
        </div>

        {/* what you get once unlocked */}
        <div className="relative mt-8 grid gap-3 sm:grid-cols-3">
          {[
            "Android Terminal APK",
            "AI signals feed",
            `v1.0.0 · 18.4 MB`,
          ].map((item) => (
            <div
              key={item}
              className="rounded-md border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-center"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                {item}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default AccessRestricted;
