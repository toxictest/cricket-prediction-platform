"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Terminal-styled toast surface.
 * Mounted once in the root layout; call `toast.success(...)` from anywhere.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={20}
      gap={10}
      duration={4200}
      visibleToasts={4}
      closeButton
      richColors={false}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: [
            "group toast",
            "!rounded-md !border !border-red-500/25",
            "!bg-zinc-950/95 !backdrop-blur-xl",
            "!text-zinc-200 !shadow-[0_0_28px_rgba(239,68,68,0.22)]",
            "!font-sans",
          ].join(" "),
          title:
            "!font-mono !text-[13px] !font-semibold !uppercase !tracking-wider !text-white",
          description: "!text-zinc-400 !text-[13px] !leading-relaxed",
          actionButton:
            "!bg-red-600 !text-white !font-mono !uppercase !tracking-wider !text-[11px] !rounded",
          cancelButton:
            "!bg-zinc-800 !text-zinc-300 !font-mono !uppercase !tracking-wider !text-[11px] !rounded",
          closeButton:
            "!bg-zinc-900 !border-red-500/30 !text-zinc-400 hover:!text-red-300",
          success: "!border-emerald-500/30 !shadow-[0_0_28px_rgba(16,185,129,0.2)]",
          error: "!border-red-500/50 !shadow-[0_0_28px_rgba(239,68,68,0.3)]",
          warning: "!border-amber-500/35 !shadow-[0_0_28px_rgba(245,158,11,0.2)]",
          info: "!border-cyan-500/35 !shadow-[0_0_28px_rgba(6,182,212,0.2)]",
          loading: "!border-zinc-700",
          icon: "!text-red-400",
        },
      }}
    />
  );
}
