"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Copy-to-clipboard with graceful degradation.
 *
 * `navigator.clipboard` only exists on secure origins, so we fall back to a
 * hidden `<textarea>` + `document.execCommand("copy")` for plain-HTTP LAN
 * testing (e.g. scanning a dev server from a phone).
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export type CopyButtonProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  toastMessage?: string;
  /** Renders as a compact icon-only control. */
  iconOnly?: boolean;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
};

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  toastMessage,
  iconOnly = false,
  className,
  variant = "neon",
  size = "sm",
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "error");

    if (ok) {
      toast.success(toastMessage ?? "Copied to clipboard");
    } else {
      toast.error("Couldn't access the clipboard — please copy manually.");
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState("idle"), 2000);
  }, [value, toastMessage]);

  const Icon = state === "copied" ? Check : state === "error" ? TriangleAlert : Copy;
  const text = state === "copied" ? copiedLabel : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={cn(
        state === "copied" &&
          "!border-emerald-500/50 !text-emerald-300 hover:!bg-emerald-500/10",
        className,
      )}
      aria-label={iconOnly ? `${label} to clipboard` : undefined}
      title={iconOnly ? label : undefined}
    >
      <Icon
        className={cn("transition-transform", state === "copied" && "scale-110")}
        aria-hidden="true"
      />
      {!iconOnly && <span>{text}</span>}
    </Button>
  );
}

export default CopyButton;
