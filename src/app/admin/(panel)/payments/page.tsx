import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink, Inbox, ShieldAlert } from "lucide-react";
import { checkAdminPage, REVIEW_ROLES, ADMIN_HOME_PATH, ADMIN_LOGIN_PATH } from "@/lib/admin-web";
import { listPaymentRequests } from "@/lib/payment";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import {
  AdminCard,
  AdminAccessNotice,
  AdminPageHeader,
  EmptyState,
  RupeeValue,
  StatusPill,
  TokenValue,
} from "@/components/admin/admin-primitives";
import { PaymentActions } from "@/components/admin/payment-actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const TABS = ["PENDING", "APPROVED", "REJECTED"] as const;
type Tab = (typeof TABS)[number];

const PAGE_SIZE = 25;

/* ==========================================================================
   DEPOSIT CLAIMS
   ==========================================================================

   Read straight through `listPaymentRequests` — the same service the API route
   calls — because this is a server component with the database on hand. What the
   page deliberately does NOT do is write: approving and rejecting go out to
   `POST /api/admin/payments/:id/*` (see `PaymentActions`), so the lock, the
   state machine, the wallet credit and the `MONEY_MODE` gate stay in exactly one
   place. Two doors into that logic is how panels end up crediting twice.
   ========================================================================== */

function query(path: string, status: Tab, cursor: string | null) {
  const search = new URLSearchParams({ status });
  if (cursor) search.set("cursor", cursor);
  return `${path}?${search.toString()}`;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The page's own gate. Reading the queue here bypasses the API route's
  // `requireAdmin([SUPER_ADMIN, PAYMENT_ADMIN])`, so the check is repeated rather
  // than assumed: a SUPPORT_ADMIN gets this notice and no rows, not a redirect.
  const access = await checkAdminPage(REVIEW_ROLES);
  if (!access.ok) {
    // Signed out: hand off exactly as the panel layout does. Layouts and pages in
    // one request are rendered in parallel, so a notice here would be shipped in
    // the same document as the browser's own redirect — markup for a page nobody
    // is allowed to see. The layout wins in the browser; saying nothing is tidier.
    if (access.reason === "signed-out") redirect(ADMIN_LOGIN_PATH);

    return (
      <div>
        <AdminPageHeader eyebrow="money in" title="Payments" description="Deposit claims waiting on you." />
        <AdminAccessNotice
          title="Payments are not your queue"
          body="Deposit claims are reviewed by a payment admin. Ask a super admin for the PAYMENT_ADMIN role if that should be you — the notice is deliberate rather than a redirect, because bouncing you away from a link you were shown would look like a bug."
          roles={REVIEW_ROLES}
        />
      </div>
    );
  }

  const params = (await searchParams) ?? {};
  const rawStatus = typeof params.status === "string" ? params.status.toUpperCase() : "";
  const status: Tab = (TABS as readonly string[]).includes(rawStatus) ? (rawStatus as Tab) : "PENDING";
  const cursor = typeof params.cursor === "string" && params.cursor ? params.cursor : null;

  const page = await listPaymentRequests({ status, cursor, limit: PAGE_SIZE });

  return (
    <div>
      <AdminPageHeader
        eyebrow="money in"
        title="Deposit claims"
        description={
          status === "PENDING"
            ? "Every row is a member who says they paid. Approving credits their wallet and writes the ledger entry; it cannot be undone from here."
            : `Closed claims. Nothing on this tab can be re-reviewed — the API refuses a second decision.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((tab) => {
              const active = tab === status;
              return (
                <Link
                  key={tab}
                  href={query("/admin/payments", tab, null)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-md border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors",
                    active
                      ? "border-red-500/45 bg-red-500/[0.09] text-white"
                      : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {tab}
                  <span className="tabular-nums text-zinc-500">{page.counts[tab]}</span>
                </Link>
              );
            })}
          </div>
        }
      />

      {page.items.length === 0 ? (
        <AdminCard>
          <EmptyState
            icon={Inbox}
            title={status === "PENDING" ? "Queue is clear" : "Nothing here yet"}
            description={
              status === "PENDING"
                ? "No member is waiting on a deposit review right now."
                : "This tab has no claims to show for the current filter."
            }
          />
        </AdminCard>
      ) : (
        <AdminCard className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  {["Filed", "Member", "Claimed", "UTR / evidence", "Status", ""].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-3 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-zinc-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.items.map((payment) => (
                  <tr
                    key={payment.id}
                    id={`claim-${payment.id}`}
                    className="scroll-mt-24 border-b border-white/[0.05] align-top transition-colors last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className="block font-mono text-[12px] text-zinc-200">{timeAgo(payment.createdAt)}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-zinc-600">
                        {formatDateTime(payment.createdAt)}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="block text-[13px] font-semibold text-white">{payment.user.name}</span>
                      <span className="mt-0.5 block text-[11.5px] text-zinc-500">{payment.user.email}</span>
                      <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                        {payment.user.referralCode}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      <RupeeValue amount={payment.amount} />
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">credit</span>
                        <TokenValue amount={payment.tokensToCredit} />
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="block font-mono text-[12px] text-zinc-200">{payment.utrNumber}</span>
                      <a
                        href={payment.screenshotUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-400/90 transition-colors hover:text-red-300"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        open receipt
                      </a>
                      {payment.reviewNote && (
                        <p className="mt-2 max-w-[22rem] rounded border border-white/[0.07] bg-black/30 p-2 text-[11.5px] leading-relaxed text-zinc-400">
                          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
                            note
                          </span>
                          <br />
                          {payment.reviewNote}
                        </p>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      <StatusPill status={payment.status} />
                      {payment.reviewedBy && (
                        <span className="mt-1.5 block font-mono text-[10px] text-zinc-600">
                          by {payment.reviewedBy.name}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      {payment.status === "PENDING" ? (
                        <PaymentActions payment={payment} />
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-700">
                          closed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              {page.items.length} of {page.counts[status]} {status.toLowerCase()} claims
            </p>
            <div className="flex items-center gap-2">
              {cursor && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={query("/admin/payments", status, null)}>
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Newest
                  </Link>
                </Button>
              )}
              {page.nextCursor && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={query("/admin/payments", status, page.nextCursor)}>
                    Older
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </AdminCard>
      )}

      <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed text-zinc-600">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Receipts open in a new tab rather than being inlined: they are member-uploaded URLs, and the panel
          does not fetch untrusted images into the page.{" "}
          <Link href={ADMIN_HOME_PATH} className="text-zinc-500 underline decoration-dotted hover:text-zinc-300">
            Back to the dashboard
          </Link>
        </span>
      </p>
    </div>
  );
}
