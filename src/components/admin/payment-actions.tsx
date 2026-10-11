"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { adminCall } from "@/lib/admin-client";
import type { PaymentQueueItem } from "@/lib/payment";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ReviewDialog } from "@/components/admin/review-dialog";

/* ==========================================================================
   ONE ROW, TWO DECISIONS
   ==========================================================================

   The island does not move money — it asks the guarded endpoint to:

     POST /api/admin/payments/:id/approve   ->  claim flips, wallet credited,
                                                DEPOSIT ledger row, reviewedBy,
                                                all in one $transaction
     POST /api/admin/payments/:id/reject    ->  claim flips with a mandatory note

   which is why every rule that matters (only PENDING rows, `MONEY_MODE` on, one
   admin per review, the exact token amount already frozen on the claim) survives
   even though a UI now sits in front of it. On success we only refresh: the page
   re-reads the queue from the database rather than the island guessing what the
   balances became.
   ========================================================================== */

type ReviewMode = "approve" | "reject";

export function PaymentActions({ payment }: { payment: PaymentQueueItem }) {
  const router = useRouter();
  const [mode, setMode] = useState<ReviewMode | null>(null);

  async function submit(next: ReviewMode, values: Record<string, string>) {
    const result = await adminCall<{ payment?: { updatedAt?: string } }>(
      `/api/admin/payments/${payment.id}/${next}`,
      {
        method: "POST",
        body: values.reviewNote ? { reviewNote: values.reviewNote } : {},
      },
    );

    if (!result.ok) {
      // The dialog keeps itself open and shows this; the row stays as it was.
      throw new Error(result.error);
    }

    toast.success(next === "approve" ? "Claim approved" : "Claim rejected", {
      description:
        next === "approve"
          ? `${payment.tokensToCredit.toLocaleString("en-IN")} tokens credited to ${payment.user.name}.`
          : `${payment.user.name} was refunded nothing — the claim simply closed.`,
    });
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="icon-sm" variant="neon" onClick={() => setMode("approve")} title="Approve and credit">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Approve claim from {payment.user.name}</span>
        </Button>
        <Button type="button" size="icon-sm" variant="outline" onClick={() => setMode("reject")} title="Reject with a note">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Reject claim from {payment.user.name}</span>
        </Button>
      </div>

      <ReviewDialog
        open={mode === "approve"}
        onOpenChange={(next) => setMode(next ? "approve" : null)}
        title="Approve this deposit"
        tone="neon"
        confirmLabel="Approve & credit"
        pendingLabel="Crediting"
        blurb={
          <>
            Credits <strong className="font-semibold text-white">{payment.tokensToCredit.toLocaleString("en-IN")} tokens</strong>{" "}
            for the ₹{payment.amount.toLocaleString("en-IN")} claimed by{" "}
            <strong className="font-semibold text-white">{payment.user.name}</strong> (UTR{" "}
            <span className="font-mono text-[12px] text-zinc-200">{payment.utrNumber}</span>). An approved
            claim cannot be reversed from the panel — a mistake is corrected with a manual ledger entry, so
            check the UTR against your bank statement first.
          </>
        }
        fields={[
          {
            name: "reviewNote",
            label: "Internal note (optional)",
            type: "textarea",
            maxLength: 500,
            placeholder: "Matched against the 4:12 pm HDFC credit.",
            hint: "Stored on the claim for the audit trail. The member never sees it.",
          },
        ]}
        submit={(values) => submit("approve", values)}
      />

      <ReviewDialog
        open={mode === "reject"}
        onOpenChange={(next) => setMode(next ? "reject" : null)}
        title="Reject this deposit"
        tone="destructive"
        confirmLabel="Reject claim"
        pendingLabel="Rejecting"
        blurb={
          <>
            Closes the claim filed {formatDateTime(payment.createdAt)} by{" "}
            <strong className="font-semibold text-white">{payment.user.name}</strong> and credits nothing.
            The note below is what the member is told — write it as you would want to read it after being
            refused.
          </>
        }
        fields={[
          {
            name: "reviewNote",
            label: "Reason for rejection",
            type: "textarea",
            required: true,
            minLength: 3,
            maxLength: 500,
            placeholder: "UTR does not match any credit to our account on 11 Oct.",
            hint: "3-500 characters. Required — a rejection without a reason is refused by the API.",
          },
        ]}
        submit={(values) => submit("reject", values)}
      />
    </>
  );
}
