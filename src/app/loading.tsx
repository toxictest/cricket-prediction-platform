import { Terminal } from "lucide-react";

/**
 * Streaming fallback shown while a route segment resolves.
 * Mirrors the terminal aesthetic rather than a generic spinner.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[70dvh] flex-col items-center justify-center gap-6 px-6"
    >
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin-slow rounded-full border border-red-500/25 border-t-red-500"
        />
        <span
          aria-hidden="true"
          className="absolute inset-2 animate-pulse-glow rounded-full"
        />
        <Terminal className="relative h-5 w-5 text-red-400" aria-hidden="true" />
      </div>

      <div className="w-full max-w-xs">
        <div className="terminal overflow-hidden">
          <div className="flex items-center gap-2 border-b border-red-500/20 bg-black/40 px-3.5 py-2">
            <span className="h-2 w-2 rounded-full bg-red-500/80" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider text-zinc-500">
              loading segment…
            </span>
          </div>
          <div className="space-y-1.5 p-3.5">
            {[92, 68, 80].map((width, index) => (
              <div
                key={width}
                className="relative h-2.5 overflow-hidden rounded-sm bg-zinc-900"
                style={{ width: `${width}%` }}
              >
                <span
                  className="absolute inset-0 animate-sweep-x bg-gradient-to-r from-transparent via-red-500/20 to-transparent"
                  style={{ animationDelay: `${index * 0.18}s` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
        Establishing connection
      </p>
    </div>
  );
}
