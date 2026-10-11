"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/admin/admin-primitives";

/* ==========================================================================
   ONE DIALOG FOR EVERY CONFIRMATION IN THE PANEL
   ==========================================================================

   Approving a claim, rejecting one and confirming a payout are the same shape:
   read the consequence, type an optional or mandatory note, press one button that
   cannot be double-pressed. The server owns the rules (a rejection note is 3-500
   characters, a payout reference has its own format); this component only asks for
   them before the request goes out, so a fixable mistake costs a keystroke and not
   a round trip.
   ========================================================================== */

export type ReviewField = {
  name: string;
  label: string;
  type?: "text" | "textarea";
  hint?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
};

export function ReviewDialog({
  open,
  onOpenChange,
  title,
  blurb,
  fields,
  confirmLabel,
  pendingLabel,
  tone = "neon",
  submit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  blurb: ReactNode;
  fields: ReviewField[];
  confirmLabel: string;
  pendingLabel: string;
  tone?: "neon" | "destructive";
  /** Throws with the operator-facing message when the request fails. */
  submit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Each time the dialog opens it is a fresh decision: no leftover note from the
  // row the operator inspected a second ago.
  useEffect(() => {
    if (!open) return;
    setValues({});
    setErrors({});
    setBusy(false);
  }, [open]);

  function change(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function requestClose(next: boolean) {
    // Dismissing mid-request would leave the operator unsure whether the money moved.
    if (busy) return;
    onOpenChange(next);
  }

  async function confirm() {
    const missing: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.name] ?? "").trim();
      if (field.required && !value) {
        missing[field.name] = `${field.label} is required.`;
        continue;
      }
      if (value && field.minLength && value.length < field.minLength) {
        missing[field.name] = `Use at least ${field.minLength} characters so the next person understands why.`;
      }
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setBusy(true);
    try {
      const trimmed: Record<string, string> = {};
      for (const field of fields) {
        const value = (values[field.name] ?? "").trim();
        if (value) trimmed[field.name] = value;
      }
      await submit(trimmed);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The server refused the request.";
      setErrors({ form: message });
      toast.error("Not applied", { description: message, duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold text-white">{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[13px] leading-relaxed text-zinc-400">{blurb}</div>
          </DialogDescription>
        </DialogHeader>

        {errors.form && (
          <div className="flex items-start gap-2.5 rounded-md border border-red-500/40 bg-red-500/[0.08] p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <p className="text-[12.5px] leading-relaxed text-red-200">{errors.form}</p>
          </div>
        )}

        {fields.length > 0 && (
          <div className="space-y-4">
            {fields.map((field) => (
              <Field
                key={field.name}
                label={field.label}
                htmlFor={`review-${field.name}`}
                hint={field.hint}
                error={errors[field.name]}
              >
                {field.type === "textarea" ? (
                  <textarea
                    id={`review-${field.name}`}
                    rows={4}
                    maxLength={field.maxLength}
                    value={values[field.name] ?? ""}
                    onChange={(event) => change(field.name, event.target.value)}
                    placeholder={field.placeholder}
                    aria-invalid={errors[field.name] ? true : undefined}
                    className={
                      "flex w-full resize-y rounded-md border border-input bg-zinc-950/60 px-3.5 py-2.5 text-sm text-foreground shadow-inner-line backdrop-blur transition-all duration-250 ease-cyber placeholder:text-zinc-600 hover:border-zinc-700 focus-visible:border-red-500/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-700 font-mono"
                    }
                  />
                ) : (
                  <Input
                    id={`review-${field.name}`}
                    maxLength={field.maxLength}
                    terminal
                    value={values[field.name] ?? ""}
                    onChange={(event) => change(field.name, event.target.value)}
                    placeholder={field.placeholder}
                    disabled={busy}
                    aria-invalid={errors[field.name] ? true : undefined}
                  />
                )}
              </Field>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => requestClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant={tone} onClick={confirm} loading={busy} loadingText={pendingLabel}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
