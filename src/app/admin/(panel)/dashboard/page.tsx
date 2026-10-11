import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  Clock,
  Inbox,
  ShieldCheck,
  Trophy,
  Wallet,
} from "lucide-react";
import {
  requireAdminPage,
  hasRole,
  ADMIN_SECTIONS,
  MATCH_ROLES,
  REVIEW_ROLES,
  roleLabels,
} from "@/lib/admin-web";
import { listPaymentRequests } from "@/lib/payment";
import { listWithdrawalRequests } from "@/lib/withdrawal";
import { listMatchesForAdmin } from "@/lib/match";
import { moneyModeEnabled } from "@/lib/feature-flags";
import { formatDateTime, timeAgo } from "@/lib/utils";
import {
  AdminCard,
  AdminPageHeader,
  EmptyState,
  RupeeValue,
  StatTile,
  StatusPill,
  TokenValue,
} from "@/components/admin/admin-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/* ==========================================================================
   DASHBOARD
   ==========================================================================

   Three queries, no more. `listPaymentRequests` and friends return the whole
   queue's per-status counts alongside the page of rows, so the tiles and the
   preview list come out of the same round trip — a dashboard that runs one query
   per number is how a back office starts timing out under its own traffic.

   Every read is conditioned on the signed-in admin's roles. These services are
   the ones the API routes call, but they do not know about roles themselves; a
   support admin reading a payout queue here would be the panel leaking what the
   endpoint refuses. Same on the pages.
   ========================================================================== */

async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return {
      ok: false,
      message:
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "The database did not answer.",
    };
  }
}

export default async function AdminDashboardPage() {
  const admin = await requireAdminPage();
  const canReviewMoney = hasRole(admin, REVIEW_ROLES);
  const canManageMatches = hasRole(admin, MATCH_ROLES);

  const [claims, payouts, fixtures] = await Promise.all([
    canReviewMoney ? attempt(() => listPaymentRequests({ status: "PENDING", limit: 5 })) : null,
    canReviewMoney ? attempt(() => listWithdrawalRequests({ status: "PENDING", limit: 5 })) : null,
    canManageMatches ? attempt(() => listMatchesForAdmin({ status: "LIVE", limit: 5 })) : null,
  ]);

  const pendingClaims = claims?.ok ? claims.value : null;
  const pendingPayouts = payouts?.ok ? payouts.value : null;
  const liveMatches = fixtures?.ok ? fixtures.value : null;
  const failures = [claims, payouts, fixtures].filter((entry) => entry && !entry.ok) as {
    ok: false;
    message: string;
  }[];

  const moneyMode = moneyModeEnabled();
  const unbuilt = ADMIN_SECTIONS.filter((section) => !section.built && hasRole(admin, section.roles));

  return (
    <div>
      <AdminPageHeader
        eyebrow="control panel"
        title={`Good to see you, ${admin.name.split(" ")[0]}`}
        description={
          <>
            Signed in as <span className="font-mono text-[12.5px] text-zinc-300">{admin.email}</span> with{" "}
            {roleLabels(admin.roles).join(", ")}. Session expires{" "}
            {formatDateTime(admin.sessionExpiresAt.toISOString())}.
          </>
        }
        actions={
          canReviewMoney ? (
            <Button variant="neon" size="sm" asChild>
              <Link href="/admin/payments?status=PENDING">
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                Review payments
              </Link>
            </Button>
          ) : (
            <Badge variant="outline">
              <ShieldCheck aria-hidden="true" />
              read-only for you
            </Badge>
          )
        }
      />

      {!moneyMode && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-[13px] leading-relaxed text-amber-100/85">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              MONEY_MODE=off
            </span>{" "}
            — queues are readable, but approve/reject/payout endpoints answer 503 by design. This is the
            safe default in production until the flow has been signed off.
          </p>
        </div>
      )}

      {failures.length > 0 && (
        <div role="alert" className="mb-6 rounded-lg border border-red-500/35 bg-red-500/[0.06] p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">
            Some numbers could not be read
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-zinc-400">
            {failures.map((failure, index) => (
              <li key={index}>· {failure.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canReviewMoney ? (
          <>
            <StatTile
              icon={CircleDollarSign}
              label="claims waiting"
              value={pendingClaims ? String(pendingClaims.counts.PENDING) : "—"}
              hint={
                pendingClaims
                  ? `${pendingClaims.counts.APPROVED} approved · ${pendingClaims.counts.REJECTED} rejected`
                  : "Payment queue unavailable"
              }
              tone="amber"
            />
            <StatTile
              icon={Wallet}
              label="payouts waiting"
              value={pendingPayouts ? String(pendingPayouts.counts.PENDING) : "—"}
              hint={
                pendingPayouts
                  ? `${pendingPayouts.counts.APPROVED} paid · ${pendingPayouts.counts.REJECTED} refunded`
                  : "Payout queue unavailable"
              }
              tone="cyan"
            />
          </>
        ) : (
          <StatTile
            icon={ShieldCheck}
            label="money queues"
            value="hidden"
            hint="Your roles do not include a payment or withdrawal admin, so neither queue is shown to you."
            tone="zinc"
          />
        )}

        {canManageMatches && (
          <>
            <StatTile
              icon={Trophy}
              label="live now"
              value={liveMatches ? String(liveMatches.counts.LIVE) : "—"}
              hint={
                liveMatches
                  ? `${liveMatches.counts.UPCOMING} upcoming · ${liveMatches.counts.COMPLETED} completed`
                  : "Fixtures unavailable"
              }
              tone="red"
            />
            <StatTile
              icon={Clock}
              label="upcoming"
              value={liveMatches ? String(liveMatches.counts.UPCOMING) : "—"}
              hint="Predictions close at the first ball. Keep the window honest."
              tone="emerald"
            />
          </>
        )}
      </div>

      {canReviewMoney && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <AdminCard>
            <QueueHeading
              title="Deposit claims waiting"
              count={pendingClaims?.counts.PENDING ?? 0}
              href="/admin/payments?status=PENDING"
            />
            {pendingClaims && pendingClaims.items.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {pendingClaims.items.map((payment) => (
                  <li key={payment.id}>
                    <Link
                      href={`/admin/payments?status=PENDING#claim-${payment.id}`}
                      className="group flex items-center gap-3 rounded-md border border-white/[0.06] px-3 py-2.5 transition-colors hover:border-red-500/35 hover:bg-red-500/[0.04]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-white">
                          {payment.user.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10.5px] text-zinc-500">
                          UTR {payment.utrNumber} · {timeAgo(payment.createdAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <RupeeValue amount={payment.amount} />
                        <TokenValue amount={payment.tokensToCredit} />
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-red-400"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Inbox}
                title="Nothing waiting"
                description="Every claim filed so far has been decided. New ones land here the moment a member submits a UTR."
              />
            )}
          </AdminCard>

          <AdminCard>
            <QueueHeading
              title="Payout requests waiting"
              count={pendingPayouts?.counts.PENDING ?? 0}
              href={undefined}
            />
            {pendingPayouts && pendingPayouts.items.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {pendingPayouts.items.map((withdrawal) => (
                  <li
                    key={withdrawal.id}
                    className="flex items-center gap-3 rounded-md border border-white/[0.06] px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-white">
                        {withdrawal.user.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-zinc-500">
                        {withdrawal.upiId} · {timeAgo(withdrawal.createdAt)}
                      </span>
                    </span>
                    <RupeeValue amount={withdrawal.amount} />
                    <StatusPill status={withdrawal.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Wallet}
                title="No payouts requested"
                description="Nobody has asked to move tokens back to their bank right now."
              />
            )}
            <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11.5px] leading-relaxed text-zinc-600">
              Approving a payout pays out of your UPI handle and never touches the balance again — the debit
              already happened when the member asked. The console to do it is the next page built.
            </p>
          </AdminCard>
        </div>
      )}

      {canManageMatches && (
        <AdminCard className="mt-4">
          <QueueHeading title="On the field" count={liveMatches?.counts.LIVE ?? 0} href={undefined} />
          {liveMatches && liveMatches.items.length > 0 ? (
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {liveMatches.items.map((match) => (
                <li
                  key={match.id}
                  className="rounded-md border border-white/[0.06] px-3.5 py-3 transition-colors hover:border-red-500/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[13px] font-semibold text-white">{match.title}</p>
                    <StatusPill status={match.status} />
                  </div>
                  <p className="mt-2 font-mono text-[12px] text-zinc-300">
                    {match.score
                      ? `${match.score.teamAScore}  ·  ${match.score.teamBScore}`
                      : `${match.teamA} vs ${match.teamB} — no ball published yet`}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                    {match.score ? `over ${match.score.currentOver} · v${match.score.version}` : `starts ${timeAgo(match.startTime.toISOString())}`}
                    {match.hasQrCode ? " · qr set" : " · no qr"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Trophy}
              title="No match is live"
              description="Score entry, fixture creation and the QR picker are the next three pages of this panel; the API behind them is already in place and guarded."
            />
          )}
        </AdminCard>
      )}

      {unbuilt.length > 0 && (
        <p className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          not built yet: {unbuilt.map((section) => section.label).join(", ")} — the APIs behind them are live
          and guarded today
        </p>
      )}
    </div>
  );
}

function QueueHeading({ title, count, href }: { title: string; count: number; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{title}</h2>
      {href ? (
        <Link
          href={href}
          className="group inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-red-400/90 hover:text-red-300"
        >
          <span className="tabular-nums text-zinc-500">{count}</span>
          open
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      ) : (
        <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-zinc-600">{count}</span>
      )}
    </div>
  );
}
