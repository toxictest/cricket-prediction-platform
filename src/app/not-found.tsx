import Link from "next/link";
import type { Metadata } from "next";
import { Home, Radio, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "404 — Signal Lost",
  description: "That route does not exist on this node.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main"
      className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 py-20"
    >
      <div className="relative w-full max-w-xl text-center">
        <div
          aria-hidden="true"
          className="absolute -inset-8 rounded-3xl bg-red-600/[0.10] blur-[80px]"
        />

        <div className="relative overflow-hidden rounded-lg glass-strong neon-border p-8 sm:p-12">
          <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/[0.08]">
            <SearchX className="h-6 w-6 text-red-400" aria-hidden="true" />
          </div>

          <Badge variant="destructive" className="relative mt-6">
            404 · Not found
          </Badge>

          <h1 className="relative mt-5 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Signal <span className="text-gradient-fire">lost</span>
          </h1>

          <p className="relative mx-auto mt-4 max-w-sm text-[14.5px] leading-relaxed text-zinc-400">
            That route is not mapped on this node. It may have been moved,
            renamed, or never existed.
          </p>

          {/* terminal readout */}
          <div className="relative mx-auto mt-7 max-w-sm rounded-md border border-red-500/25 bg-black/60 p-4 text-left">
            <code className="block font-mono text-[11px] leading-relaxed text-zinc-500">
              <span className="text-red-500">$</span> resolve --route
            </code>
            <code className="mt-1.5 block font-mono text-[11px] leading-relaxed text-amber-400">
              warn: no handler matched
            </code>
            <code className="mt-1.5 block font-mono text-[11px] leading-relaxed text-zinc-600">
              fallback → landing
            </code>
          </div>

          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/" className="w-full sm:w-auto">
              <Button variant="default" className="w-full sm:w-auto">
                <Home aria-hidden="true" />
                Back to home
              </Button>
            </Link>
            <Link href="/register" className="w-full sm:w-auto">
              <Button variant="cyber" className="w-full sm:w-auto">
                <Radio aria-hidden="true" />
                Activate Account
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
