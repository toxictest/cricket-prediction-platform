"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TerminalLine = {
  /** Text printed for this line. */
  text: string;
  /** Terminal colour role. */
  tone?: "default" | "accent" | "muted" | "success" | "warning" | "command";
  /** Milliseconds to wait before printing this line. Defaults to 420. */
  delay?: number;
};

const TONE_CLASS: Record<NonNullable<TerminalLine["tone"]>, string> = {
  default: "text-zinc-300",
  accent: "text-red-400",
  muted: "text-zinc-500",
  success: "text-emerald-400",
  warning: "text-amber-400",
  command: "text-zinc-100",
};

/**
 * TerminalWindow
 * ──────────────
 * Types a list of lines out character-by-character, then keeps a blinking
 * caret. Respects `prefers-reduced-motion` by rendering everything instantly.
 *
 * The string is painted into the DOM one line at a time using a single state
 * value, so React re-renders ~1 per keystroke-group rather than per character.
 */
export function TerminalWindow({
  lines,
  title = "guest@cpc:~/access",
  className,
  /** Characters revealed per animation frame. */
  speed = 2,
  /** Begin typing automatically on mount. */
  autoStart = true,
  /** Show the traffic-light chrome. */
  chrome = true,
}: {
  lines: TerminalLine[];
  title?: string;
  className?: string;
  speed?: number;
  autoStart?: boolean;
  chrome?: boolean;
}) {
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [activeText, setActiveText] = useState("");
  const [done, setDone] = useState(false);
  const lineIndexRef = useRef(0);
  const charIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoStart) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVisibleLines(lines.map((l) => l.text));
      setActiveText("");
      setDone(true);
      return;
    }

    let cancelled = false;

    function nextChar() {
      if (cancelled) return;

      const line = lines[lineIndexRef.current];
      if (!line) {
        setDone(true);
        return;
      }

      const full = line.text;
      const nextIndex = charIndexRef.current + speed;

      if (nextIndex >= full.length) {
        setVisibleLines((prev) => [...prev, full]);
        setActiveText("");
        lineIndexRef.current += 1;
        charIndexRef.current = 0;

        const upcoming = lines[lineIndexRef.current];
        timerRef.current = setTimeout(nextChar, upcoming?.delay ?? 420);
        return;
      }

      charIndexRef.current = nextIndex;
      setActiveText(full.slice(0, nextIndex));
      timerRef.current = setTimeout(nextChar, 16);
    }

    // Small initial pause so the window doesn't start mid-paint.
    timerRef.current = setTimeout(nextChar, 260);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lines, speed, autoStart]);

  // Keep the newest output in view as the log grows.
  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visibleLines, activeText]);

  const activeLine = lines[lineIndexRef.current];
  const activeTone = activeLine?.tone ?? "default";

  return (
    <div className={cn("terminal overflow-hidden", className)}>
      {chrome && (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-black/40 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
          </span>
          <span className="ml-2 truncate font-mono text-[11px] tracking-wider text-zinc-500">
            {title}
          </span>
          <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.2em] text-red-500/60 sm:inline">
            ● live
          </span>
        </div>
      )}

      <div
        ref={scrollerRef}
        className="no-scrollbar max-h-[22rem] overflow-y-auto p-4 sm:p-5"
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
      >
        <div className="space-y-1.5 font-mono text-[12px] leading-relaxed sm:text-[13px]">
          {visibleLines.map((text, index) => {
            const line = lines[index];
            return (
              <div
                key={`${index}-${text}`}
                className={cn("flex gap-2", TONE_CLASS[line?.tone ?? "default"])}
              >
                <span className="shrink-0 select-none text-red-500/60">
                  {line?.tone === "command" ? "❯" : "·"}
                </span>
                <span className="min-w-0 break-words">{text}</span>
              </div>
            );
          })}

          {!done && activeText && (
            <div className={cn("flex gap-2", TONE_CLASS[activeTone])}>
              <span className="shrink-0 select-none text-red-500/60">
                {activeTone === "command" ? "❯" : "·"}
              </span>
              <span className="min-w-0 break-words">
                {activeText}
                <span className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-[1px] animate-caret-blink bg-red-500 align-middle" />
              </span>
            </div>
          )}

          {done && (
            <div className="flex gap-2 text-zinc-100">
              <span className="shrink-0 select-none text-red-500">❯</span>
              <span className="inline-block h-3.5 w-[7px] translate-y-[1px] animate-caret-blink bg-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TerminalWindow;
