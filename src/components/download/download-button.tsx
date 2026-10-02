"use client";

import { useCallback, useState } from "react";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * DownloadButton
 * ──────────────
 * A real anchor (`<a download>`) rather than a JS-triggered navigation, so the
 * browser's own download manager, progress UI and resume support all work.
 *
 * The click handler only drives the optimistic "preparing" state and a toast.
 * It never intercepts the navigation — if the session has expired the API
 * responds 401 and the browser surfaces the JSON error, which we also pre-empt
 * with a client-side reminder.
 */
export function DownloadButton({
  href,
  fileName,
  version,
  sizeLabel,
  className,
}: {
  href: string;
  fileName: string;
  version: string;
  sizeLabel: string;
  className?: string;
}) {
  const [preparing, setPreparing] = useState(false);

  const handleClick = useCallback(() => {
    setPreparing(true);

    toast.success("Download starting", {
      description: `${fileName} · v${version} · ${sizeLabel}`,
      duration: 5000,
    });

    // The browser owns the download from here; release the button after a beat
    // so repeat clicks stay possible.
    setTimeout(() => setPreparing(false), 2600);
  }, [fileName, version, sizeLabel]);

  return (
    <Button
      asChild
      size="xl"
      variant="default"
      className={cn("group w-full sm:w-auto", className)}
    >
      <a
        href={href}
        download={fileName}
        onClick={handleClick}
        aria-label={`Download ${fileName} version ${version}, ${sizeLabel}`}
        // Extensions and "open in new tab" users keep the referrer off.
        rel="noopener noreferrer"
      >
        {preparing ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Download
            className="transition-transform duration-300 group-hover:translate-y-0.5"
            aria-hidden="true"
          />
        )}
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[15px] font-bold">
            {preparing ? "Preparing build…" : "Download APK"}
          </span>
          <span className="font-mono text-[10px] font-normal uppercase tracking-[0.14em] opacity-80">
            v{version} · {sizeLabel}
          </span>
        </span>
      </a>
    </Button>
  );
}

/* ==========================================================================
   SECONDARY: direct static mirror
   ========================================================================== */

export function MirrorLink({
  href,
  fileName,
}: {
  href: string;
  fileName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      toast.success("Mirror URL copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard unavailable — copy the URL manually.");
    }
  }, [href]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 max-w-full flex-1 truncate rounded border border-white/[0.08] bg-black/40 px-3 py-2.5 font-mono text-[11px] text-zinc-500">
        {href}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "shrink-0 rounded border border-white/10 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider",
          "text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-300",
          copied && "border-emerald-500/50 text-emerald-300",
        )}
      >
        {copied ? "copied" : "copy"}
      </button>
      <span className="sr-only">{fileName}</span>
    </div>
  );
}

/* ==========================================================================
   VERIFY CHECKSUM
   ========================================================================== */

export function ChecksumRow({
  checksum,
  label = "SHA-256",
}: {
  checksum: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded border border-white/[0.07] bg-black/40 px-3.5 py-3">
      <ShieldCheck
        className="h-4 w-4 shrink-0 text-emerald-500/70"
        aria-hidden="true"
      />
      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
        {checksum}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(checksum);
            setCopied(true);
            toast.success("Checksum copied");
            setTimeout(() => setCopied(false), 2000);
          } catch {
            toast.error("Clipboard unavailable");
          }
        }}
        className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500 transition-colors hover:text-red-400"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
