"use client";

import { useState } from "react";
import { BookOpen, Check, Copy, Smartphone, Terminal } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Download the artifact",
    body: "Tap the download button above. The file lands in your device's Downloads folder as app-release.apk.",
  },
  {
    title: "Allow installation from this source",
    body: "Android blocks sideloaded builds by default. When prompted, open Settings → Apps → Special access → Install unknown apps and enable it for your browser or file manager. On most devices the prompt appears automatically after you tap the file.",
  },
  {
    title: "Install the package",
    body: "Open Downloads, tap app-release.apk, then confirm Install. If Play Protect warns you about an unknown developer, choose Install anyway — the build is not distributed through the Play Store.",
  },
  {
    title: "Sign in with the same Google account",
    body: "Launch the terminal and authenticate with the Google account you registered here. The app reads your member ID and unlocks the modules your tier has earned.",
  },
  {
    title: "Verify the checksum (optional, recommended)",
    body: "Compare the SHA-256 shown on this page with a local hash: run `sha256sum app-release.apk` on Linux/macOS, or `Get-FileHash app-release.apk -Algorithm SHA256` in PowerShell. They must match exactly.",
  },
];

export function InstallGuide() {
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);

  function toggle(index: number) {
    setCompleted((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  const commands = [
    "# Linux / macOS",
    "sha256sum app-release.apk",
    "",
    "# Windows PowerShell",
    "Get-FileHash app-release.apk -Algorithm SHA256",
    "",
    "# Install over USB (adb, device with USB debugging on)",
    "adb install -r app-release.apk",
  ].join("\n");

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      toast.success("Commands copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="cyber" size="lg" className="w-full sm:w-auto">
          <BookOpen aria-hidden="true" />
          Installation Guide
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="default">
              <Smartphone aria-hidden="true" />
              Android sideload
            </Badge>
            <Badge variant="secondary">{STEPS.length} steps</Badge>
          </div>

          <DialogTitle className="font-display text-xl">
            Installing the Android Terminal
          </DialogTitle>
          <DialogDescription>
            The build is distributed directly to members rather than through the
            Play Store, so Android asks for one extra permission. Here is the
            whole path from download to first launch.
          </DialogDescription>
        </DialogHeader>

        {/* ---------------- steps ---------------- */}
        <ol className="mt-2 space-y-3">
          {STEPS.map((step, index) => {
            const done = completed.includes(index);
            return (
              <li key={step.title}>
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-pressed={done}
                  className={cn(
                    "flex w-full items-start gap-4 rounded-md border p-4 text-left",
                    "transition-all duration-300 ease-cyber",
                    done
                      ? "border-emerald-500/40 bg-emerald-500/[0.05]"
                      : "border-white/[0.07] bg-white/[0.015] hover:border-red-500/40 hover:bg-red-500/[0.035]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border font-mono text-[11px] font-bold transition-colors",
                      done
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-red-500/40 bg-red-500/10 text-red-400",
                    )}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>

                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13.5px] font-semibold transition-colors",
                        done ? "text-emerald-200" : "text-zinc-200",
                      )}
                    >
                      {step.title}
                    </span>
                    <span className="mt-1.5 block text-[12.5px] leading-relaxed text-zinc-500">
                      {step.body}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* ---------------- command block ---------------- */}
        <div className="mt-4 overflow-hidden rounded-md border border-white/[0.08] bg-black/50">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <Terminal className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
              Verification &amp; install
            </span>
            <button
              type="button"
              onClick={copyCommands}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 transition-colors hover:text-red-400"
            >
              {copied ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Copy className="h-3 w-3" aria-hidden="true" />
              )}
              {copied ? "copied" : "copy"}
            </button>
          </div>

          <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-relaxed">
            <code>
              {commands.split("\n").map((line, index) => (
                <span key={index} className="block">
                  <span
                    className={cn(
                      line.startsWith("#")
                        ? "text-zinc-600"
                        : "text-emerald-400/85",
                    )}
                  >
                    {line || "\u00A0"}
                  </span>
                </span>
              ))}
            </code>
          </pre>
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
          Minimum supported platform: Android 8.0 (Oreo, API 26). Architectures:
          arm64-v8a and armeabi-v7a.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default InstallGuide;
