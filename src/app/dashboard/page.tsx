import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Fingerprint,
  Gift,
  KeyRound,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getUserOverview } from "@/lib/user";
import { tierForReferrals, siteConfig } from "@/lib/constants";
import { formatDate, formatDateTime, timeAgo, initials } from "@/lib/utils";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CopyButton } from "@/components/shared/copy-button";
import { DashboardReferrals } from "@/components/dashboard/referral-panel";
import { AuthWelcomeBurst } from "@/components/effects/auth-welcome-burst";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your member profile, registration status, referral code and download center.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/* ==========================================================================
   SMALL BUILDING BLOCKS
   ========================================================================== */

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  accent = "red",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
  accent?: "red" | "emerald" | "cyan" | "amber";
}) {
  const accents = {
    red: "text-red-400 shadow-[0_0_16px_rgba(239,68,68,0.18)]",
    emerald: "text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.16)]",
    cyan: "text-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.16)]",
    amber: "text-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.16)]",
  } as const;

  return (
    <div className="group relative overflow-hidden rounded-lg glass neon-border p-4 transition-all duration-350 ease-cyber hover:border-red-500/45 hover:shadow-[0_0_24px_rgba(239,68,68,0.2)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-red-500/40",
            accents[accent],
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <ArrowUpRight
          className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-red-400"
          aria-hidden="true"
        />
      </div>
      <p className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1.5 font-display text-xl font-bold text-white sm:text-2xl">
        {value}
      </p>
      {hint && (
        <p className="mt-1 font-mono text-[10px] text-zinc-600">{hint}</p>
      )}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono = false,
  action,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.055] py-3.5 last:border-0">
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-red-500/70" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          {label}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate text-right text-[13.5px] text-zinc-200",
            mono && "font-mono text-[12.5px]",
          )}
          title={value}
        >
          {value}
        </span>
        {action}
      </span>
    </div>
  );
}

/* ==========================================================================
   PAGE
   ========================================================================== */

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const overview = await getUserOverview(session.user.id);

  if (!overview) {
    // The session is valid but the row is gone (deleted account).
    redirect("/login?error=SessionRequired");
  }

  const { user, referralCount, referrals, downloadCount, lastDownloadAt } =
    overview;

  const tier = tierForReferrals(referralCount);
  const referralLink = `${siteConfig.url}/register?ref=${user.referralCode}`;

  return (
    <>
      {/*
        Plays the fire-burst payoff once when the visitor arrives from the
        Google OAuth handshake. It reads and clears a one-shot sessionStorage
        flag, so it is silent on every other visit to this page.
      */}
      <AuthWelcomeBurst />

      <Navbar />

      <main id="main" className="relative flex-1 pb-8 pt-24 sm:pt-28">
        <div className="container">
          {/* ==================================================================
              HEADER
              ================================================================== */}
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <LayoutDashboard
                  className="h-4 w-4 text-red-400"
                  aria-hidden="true"
                />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-red-500/80">
                  Member Console
                </span>
              </div>
              <h1 className="mt-3 text-balance font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
                Welcome back,{" "}
                <span className="text-gradient-fire">
                  {user.name.split(" ")[0]}
                </span>
              </h1>
              <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-500">
                Your member record is active. Everything below is read live from
                PostgreSQL — nothing here is cached.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Badge variant="success">
                <CheckCircle2 aria-hidden="true" />
                Registration active
              </Badge>
              <Badge variant="secondary">
                <Clock aria-hidden="true" />
                Since {formatDate(user.createdAt)}
              </Badge>
            </div>
          </div>

          {/* ==================================================================
              STAT TILES
              ================================================================== */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={Users}
              label="Referrals"
              value={String(referralCount)}
              hint={
                tier.next
                  ? `${tier.next.minReferrals - referralCount} to ${tier.next.name}`
                  : "Top tier reached"
              }
              accent="red"
            />
            <StatTile
              icon={Download}
              label="Downloads"
              value={String(downloadCount)}
              hint={
                lastDownloadAt
                  ? `Last ${timeAgo(lastDownloadAt)}`
                  : "No downloads yet"
              }
              accent="emerald"
            />
            <StatTile
              icon={ShieldCheck}
              label="Membership"
              value={tier.current.name}
              hint={tier.current.perk}
              accent="cyan"
            />
            <StatTile
              icon={Fingerprint}
              label="Auth provider"
              value="Google"
              hint="OAuth 2.0 · no password"
              accent="amber"
            />
          </div>

          {/* ==================================================================
              MAIN GRID
              ================================================================== */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* ---------------- left column ---------------- */}
            <div className="space-y-6">
              {/* profile card */}
              <section
                aria-labelledby="profile-heading"
                className="relative overflow-hidden rounded-lg glass-strong neon-border"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-red-600/[0.16] blur-[60px]"
                />

                <div className="relative p-6">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -inset-1 rounded-lg bg-red-500/25 blur-md"
                      />
                      <Avatar className="relative h-16 w-16 rounded-lg">
                        {user.image ? (
                          <AvatarImage
                            src={user.image}
                            alt={user.name}
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                        <AvatarFallback className="rounded-lg text-lg">
                          {initials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    <div className="min-w-0">
                      <h2
                        id="profile-heading"
                        className="truncate font-display text-lg font-bold text-white"
                      >
                        {user.name}
                      </h2>
                      <p className="mt-1 flex items-center gap-2 truncate text-[13px] text-zinc-500">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{user.email}</span>
                      </p>
                      <Badge variant="neon" className="mt-2.5">
                        <ShieldCheck aria-hidden="true" />
                        Verified member
                      </Badge>
                    </div>
                  </div>

                  <div className="divider-glow my-5" />

                  <dl className="space-y-0">
                    <DetailRow
                      icon={Calendar}
                      label="Registered"
                      value={formatDateTime(user.createdAt)}
                    />
                    <DetailRow
                      icon={Clock}
                      label="Last sign-in"
                      value={
                        user.lastLoginAt
                          ? timeAgo(user.lastLoginAt)
                          : formatDateTime(user.createdAt)
                      }
                    />
                    <DetailRow
                      icon={KeyRound}
                      label="Google ID"
                      value={user.googleId}
                      mono
                    />
                    <DetailRow
                      icon={Fingerprint}
                      label="Member ID"
                      value={user.id}
                      mono
                    />
                  </dl>
                </div>
              </section>

              {/* tier progress */}
              <section
                aria-labelledby="tier-heading"
                className="rounded-lg glass neon-border p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2
                    id="tier-heading"
                    className="font-display text-base font-semibold text-white"
                  >
                    Membership tier
                  </h2>
                  <Badge variant="neon">{tier.current.name}</Badge>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
                  Current perk:{" "}
                  <span className="text-zinc-300">{tier.current.perk}</span>
                </p>

                <div className="mt-5">
                  <Progress
                    value={tier.progress}
                    label={
                      tier.next
                        ? `Progress to ${tier.next.name}`
                        : "Maximum tier reached"
                    }
                    valueLabel={`${referralCount}${tier.next ? ` / ${tier.next.minReferrals}` : ""}`}
                  />
                </div>

                <p className="mt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
                  {tier.next
                    ? `Invite ${tier.next.minReferrals - referralCount} more member${tier.next.minReferrals - referralCount === 1 ? "" : "s"} to unlock "${tier.next.perk}".`
                    : "You have unlocked every referral perk. Thank you for growing the network."}
                </p>
              </section>
            </div>

            {/* ---------------- right column ---------------- */}
            <div className="space-y-6">
              {/* referral card */}
              <section
                aria-labelledby="referral-heading"
                className="relative overflow-hidden rounded-lg glass-strong neon-border"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-16 -top-16 h-44 w-44 rounded-full bg-red-600/[0.14] blur-[60px]"
                />

                <div className="relative p-6">
                  <div className="flex items-center justify-between gap-4">
                    <h2
                      id="referral-heading"
                      className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
                    >
                      <Gift className="h-4 w-4 text-red-400" aria-hidden="true" />
                      Your referral code
                    </h2>
                    <Badge variant="default">Auto-generated</Badge>
                  </div>

                  {/* the code */}
                  <div className="mt-5 rounded-md border border-red-500/30 bg-black/50 p-4 shadow-[inset_0_0_30px_rgba(239,68,68,0.06)]">
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-600">
                      Member code
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <code className="select-all font-mono text-xl font-bold tracking-[0.16em] text-red-400 [text-shadow:0_0_14px_rgba(239,68,68,0.55)] sm:text-2xl">
                        {user.referralCode}
                      </code>
                      <CopyButton
                        value={user.referralCode}
                        label="Copy code"
                        toastMessage="Referral code copied"
                      />
                    </div>
                  </div>

                  {/* the link */}
                  <div className="mt-4">
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
                      Share link
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded border border-white/[0.08] bg-black/40 px-3 py-2.5 font-mono text-[11px] text-zinc-400">
                        {referralLink}
                      </code>
                      <CopyButton
                        value={referralLink}
                        iconOnly
                        label="Copy link"
                        toastMessage="Referral link copied"
                        className="shrink-0"
                      />
                    </div>
                  </div>

                  <p className="mt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
                    Anyone who registers through this link is permanently
                    attributed to your account. Self-referrals are rejected
                    server-side.
                  </p>
                </div>
              </section>

              {/* download center card */}
              <section
                aria-labelledby="download-heading"
                className="relative overflow-hidden rounded-lg glass-strong neon-border"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-20 -bottom-20 h-52 w-52 rounded-full bg-red-600/[0.14] blur-[70px]"
                />

                <div className="relative p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2
                        id="download-heading"
                        className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
                      >
                        <Smartphone className="h-4 w-4 text-red-400" aria-hidden="true" />
                        Download Center
                      </h2>
                      <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
                        {downloadCount > 0
                          ? `You have downloaded the build ${downloadCount} time${downloadCount === 1 ? "" : "s"}.`
                          : "Your account is authorised — grab the Android build whenever you're ready."}
                      </p>
                    </div>
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden="true" />
                      Unlocked
                    </Badge>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Link href="/download">
                      <Button variant="default" className="group">
                        <Download aria-hidden="true" />
                        Open Download Center
                        <ArrowUpRight
                          className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                          aria-hidden="true"
                        />
                      </Button>
                    </Link>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                      v{siteConfig.appVersion} · 18.4 MB
                    </span>
                  </div>
                </div>
              </section>

              {/* referrals list */}
              <DashboardReferrals
                referrals={referrals.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  image: entry.image,
                  joinedAt: formatDate(entry.createdAt),
                }))}
                total={referralCount}
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
