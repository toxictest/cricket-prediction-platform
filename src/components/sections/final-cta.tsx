"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Download,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";

/**
 * Closing call-to-action.
 *
 * Content adapts to session state: guests are pushed toward `/register`, while
 * returning members get a shortcut straight into the Download Center.
 */
export function FinalCta({
  isAuthenticated = false,
  memberName = null,
}: {
  isAuthenticated?: boolean;
  memberName?: string | null;
}) {
  const reduce = useReducedMotion();
  const firstName = memberName?.split(" ")[0] ?? null;

  return (
    <section className="relative overflow-hidden py-20 sm:py-24 lg:py-28">
      <div className="container">
        <Reveal variant="scale">
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl px-6 py-14 text-center sm:px-12 sm:py-16",
              "glass-strong border-red-500/25",
            )}
            style={{
              boxShadow:
                "0 0 80px -20px rgba(239,68,68,0.35), inset 0 1px 0 0 rgba(255,255,255,0.06)",
            }}
          >
            {/* backdrop layers */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 cyber-grid-overlay opacity-40 mask-fade-y"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-0 h-64 w-[46rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/[0.18] blur-[90px]"
            />
            {!reduce && (
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400 to-transparent"
                animate={{ opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}

            {/* ---------------- content ---------------- */}
            <div className="relative mx-auto max-w-2xl">
              <Badge variant="neon" className="mx-auto">
                <Sparkles aria-hidden="true" />
                {isAuthenticated ? "Membership active" : "Membership required"}
              </Badge>

              <h2 className="mt-6 text-balance font-display text-2xl font-extrabold leading-tight text-white sm:text-4xl">
                {isAuthenticated ? (
                  <>
                    You&rsquo;re in
                    {firstName ? `, ${firstName}` : ""}.{" "}
                    <span className="text-gradient-fire">
                      The build is waiting.
                    </span>
                  </>
                ) : (
                  <>
                    Ready to{" "}
                    <span className="text-gradient-fire">unlock access</span>?
                  </>
                )}
              </h2>

              <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-zinc-400 sm:text-base">
                {isAuthenticated
                  ? "Your account is provisioned and your referral code is live. Head to the Download Center and pull the Android terminal onto your device."
                  : "Registration is free and takes about ten seconds. Once your Google account is linked, the Android build unlocks permanently on your account."}
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                {isAuthenticated ? (
                  <>
                    <Link href="/download" className="w-full sm:w-auto">
                      <Button size="lg" variant="default" className="group w-full sm:w-auto">
                        <Download aria-hidden="true" />
                        Open Download Center
                        <ArrowRight
                          className="transition-transform duration-300 group-hover:translate-x-1"
                          aria-hidden="true"
                        />
                      </Button>
                    </Link>
                    <Link href="/dashboard" className="w-full sm:w-auto">
                      <Button size="lg" variant="cyber" className="w-full sm:w-auto">
                        <LayoutDashboard aria-hidden="true" />
                        Dashboard
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/register" className="w-full sm:w-auto">
                      <Button size="lg" variant="default" className="group w-full sm:w-auto">
                        <ShieldCheck aria-hidden="true" />
                        Activate Account
                        <ArrowRight
                          className="transition-transform duration-300 group-hover:translate-x-1"
                          aria-hidden="true"
                        />
                      </Button>
                    </Link>
                    <Link href="/login" className="w-full sm:w-auto">
                      <Button size="lg" variant="cyber" className="w-full sm:w-auto">
                        I already have an account
                      </Button>
                    </Link>
                  </>
                )}
              </div>

              <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                No passwords stored · Google handles authentication
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default FinalCta;
