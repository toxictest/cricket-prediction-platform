import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Cpu,
  FileArchive,
  HardDrive,
  History,
  Layers,
  Package,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getUserOverview } from "@/lib/user";
import { resolveArtifact } from "@/lib/artifact";
import { appRelease, siteConfig } from "@/lib/constants";
import { formatDate, formatDateTime, timeAgo, initials, cn } from "@/lib/utils";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AccessRestricted } from "@/components/download/access-restricted";
import {
  ChecksumRow,
  DownloadButton,
  MirrorLink,
} from "@/components/download/download-button";
import { InstallGuide } from "@/components/download/install-guide";

export const metadata: Metadata = {
  title: "Download Center",
  description:
    "Members-only Android APK distribution. Verify your account and download the Cricket Prediction Community terminal.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/* ==========================================================================
   SPEC TABLE
   ========================================================================== */

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.055] py-3 last:border-0">
      <span className="flex items-center gap-2.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-red-500/70" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          {label}
        </span>
      </span>
      <span className="text-right font-mono text-[11.5px] text-zinc-300">
        {value}
      </span>
    </div>
  );
}

/* ==========================================================================
   PAGE
   ========================================================================== */

export default async function DownloadPage() {
  const session = await getServerSession(authOptions);

  /* ------------------------------------------------------------------
     GATE — defence in depth.
     `src/middleware.ts` normally issues a 307 to
     `/login?callbackUrl=/download` before this component ever runs. This
     branch covers expired sessions, edge cases where the matcher has been
     narrowed, and tokens whose database row was removed.
     ------------------------------------------------------------------ */
  if (!session?.user?.id) {
    return (
      <>
        <Navbar />
        <main id="main" className="relative flex-1 pt-24 sm:pt-28">
          <AccessRestricted reason="unauthenticated" />
        </main>
        <Footer />
      </>
    );
  }

  const overview = await getUserOverview(session.user.id);

  if (!overview) {
    return (
      <>
        <Navbar />
        <main id="main" className="relative flex-1 pt-24 sm:pt-28">
          <AccessRestricted reason="no-member-record" />
        </main>
        <Footer />
      </>
    );
  }

  const { user, downloadCount, lastDownloadAt } = overview;

  /* ------------------------------------------------------------------
     Resolve the download target.
     Priority: external CDN → guarded API route (logs + streams).
     The literal static mirror is still surfaced in the UI so the
     `http://localhost:3000/downloads/app-release.apk` path from the spec
     remains usable, and it is itself protected by the middleware matcher.

     `resolveArtifact()` also returns the REAL SHA-256 of the bytes on
     disk, so the checksum we publish always matches the file the member
     actually receives.
     ------------------------------------------------------------------ */
  const artifact = await resolveArtifact();

  /*
   * Nothing is invented when the release is missing or its manifest is
   * incomplete. A field we cannot measure renders as MISSING rather than as a
   * plausible-looking value, because a wrong checksum or version is worse than
   * an obvious gap.
   */
  const MISSING = "not set";

  const available = artifact !== null;

  const primaryHref = artifact?.externalUrl
    ? artifact.externalUrl
    : "/api/download";

  const mirrorHref = `${siteConfig.url}/downloads/${artifact?.fileName ?? appRelease.fileName}`;

  const checksum = artifact?.checksum ?? null;
  const sizeLabel = artifact?.sizeLabel ?? MISSING;
  const isStub = artifact?.isStub ?? false;
  const version = artifact?.versionName ?? siteConfig.appVersion;
  const packageName = artifact?.packageName ?? MISSING;
  const buildNumber = artifact?.buildNumber ?? null;
  const minAndroid = artifact?.minAndroid ?? MISSING;
  const architecture = artifact?.architecture ?? MISSING;

  return (
    <>
      <Navbar />

      <main id="main" className="relative flex-1 pb-8 pt-24 sm:pt-28">
        <div className="container">
          {/* ==================================================================
              HEADER
              ================================================================== */}
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Link
                href="/dashboard"
                className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-red-400"
              >
                <ArrowLeft
                  className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1"
                  aria-hidden="true"
                />
                Back to dashboard
              </Link>

              <h1 className="mt-4 text-balance font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
                Download <span className="text-gradient-fire">Center</span>
              </h1>
              <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-500">
                You are an authorised member. Every download below is streamed
                from the guarded endpoint and recorded against your account.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Badge variant="success">
                <CheckCircle2 aria-hidden="true" />
                Access granted
              </Badge>
              <Badge variant="secondary">
                <Terminal aria-hidden="true" />
                {user.referralCode}
              </Badge>
            </div>
          </div>

          {/* ==================================================================
              MAIN GRID
              ================================================================== */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {/* ---------------- PRIMARY ARTIFACT CARD ---------------- */}
            <section
              aria-labelledby="artifact-heading"
              className="relative overflow-hidden rounded-lg glass-strong neon-border"
            >
              {/* header strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
                <span className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  <Package className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
                  Release artifact
                </span>
                {available ? (
                  <Badge variant="solid">
                    <Sparkles aria-hidden="true" />
                    Latest stable
                  </Badge>
                ) : (
                  <Badge variant="warning">
                    <AlertTriangle aria-hidden="true" />
                    Build pending
                  </Badge>
                )}
              </div>

              <div className="relative p-6 sm:p-7">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-red-600/[0.15] blur-[70px]"
                />

                {/* app identity */}
                <div className="relative flex flex-wrap items-start gap-5">
                  <div className="relative shrink-0">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 animate-pulse-glow rounded-lg"
                    />
                    <span className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/[0.08]">
                      <Smartphone className="h-7 w-7 text-red-400" aria-hidden="true" />
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h2
                      id="artifact-heading"
                      className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl"
                    >
                      {appRelease.name}
                    </h2>
                    <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-red-400">
                      Version {version}
                      {buildNumber ? ` · build ${buildNumber}` : ""}
                    </p>
                    <p className="mt-3 max-w-lg font-mono text-[12px] leading-relaxed text-zinc-500">
                      {packageName}
                    </p>
                  </div>
                </div>

                {/* features */}
                <ul className="relative mt-6 grid gap-2.5 sm:grid-cols-2">
                  {appRelease.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-[13px] text-zinc-400"
                    >
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500/70"
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* actions */}
                {available ? (
                  <div className="relative mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <DownloadButton
                      href={primaryHref}
                      fileName={artifact.fileName}
                      version={version}
                      sizeLabel={sizeLabel}
                    />
                    <InstallGuide />
                  </div>
                ) : (
                  <div className="relative mt-7 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-4 py-4">
                    <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      No build staged on this server
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-amber-200/80">
                      The Download Center is wired and the access gate is
                      enforced, but no Android package has been published yet.
                      Place the signed release at{" "}
                      <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
                        storage/apk/{appRelease.fileName}
                      </code>{" "}
                      and it appears here automatically, with its size and
                      SHA-256 measured from the file.
                    </p>
                  </div>
                )}

                {/* mirror */}
                <div className="relative mt-6 border-t border-white/[0.06] pt-5">
                  <p className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
                    <FileArchive
                      className="h-3.5 w-3.5 text-red-500/60"
                      aria-hidden="true"
                    />
                    Direct mirror (same gate)
                  </p>
                  <div className="mt-2.5">
                    <MirrorLink
                      href={mirrorHref}
                      fileName={artifact?.fileName ?? appRelease.fileName}
                    />
                  </div>
                </div>

                {/* checksum — measured from the bytes actually on disk */}
                <div className="relative mt-3">
                  {checksum ? (
                    <ChecksumRow checksum={checksum} />
                  ) : (
                    <div className="flex items-center gap-3 rounded border border-white/[0.07] bg-black/40 px-3.5 py-3">
                      <ShieldCheck
                        className="h-4 w-4 shrink-0 text-zinc-600"
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                        SHA-256 unavailable — no artifact staged
                      </span>
                    </div>
                  )}
                </div>

                {/* stub guard — catches a placeholder slipping into a release */}
                {isStub && (
                  <div className="relative mt-4 flex items-start gap-3 rounded-md border border-red-500/35 bg-red-500/[0.06] px-4 py-3">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                      aria-hidden="true"
                    />
                    <p className="text-[12.5px] leading-relaxed text-red-200/85">
                      <strong className="font-semibold">
                        Suspiciously small file.
                      </strong>{" "}
                      The staged package is {sizeLabel}, which is far below the
                      size of any real Android build. Members who download this
                      will not be able to install it — replace it with the signed
                      release APK.
                    </p>
                  </div>
                )}

                {/* warning */}
                <div className="relative mt-4 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-4 py-3">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                    aria-hidden="true"
                  />
                  <p className="text-[12.5px] leading-relaxed text-amber-200/85">
                    Android will warn about installing from an unknown source.
                    That is expected for a direct distribution build — the
                    Installation Guide walks through granting the permission
                    safely.
                  </p>
                </div>
              </div>
            </section>

            {/* ---------------- RIGHT COLUMN ---------------- */}
            <div className="space-y-6">
              {/* specifications */}
              <section
                aria-labelledby="specs-heading"
                className="rounded-lg glass neon-border p-6"
              >
                <h2
                  id="specs-heading"
                  className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
                >
                  <Cpu className="h-4 w-4 text-red-400" aria-hidden="true" />
                  Build specifications
                </h2>

                <div className="mt-4">
                  <SpecRow icon={Package} label="Package" value={packageName} />
                  <SpecRow
                    icon={Layers}
                    label="Version"
                    value={
                      buildNumber ? `${version} (${buildNumber})` : version
                    }
                  />
                  <SpecRow icon={HardDrive} label="Size" value={sizeLabel} />
                  <SpecRow
                    icon={Smartphone}
                    label="Min Android"
                    value={minAndroid}
                  />
                  <SpecRow icon={Cpu} label="ABI" value={architecture} />
                  <SpecRow
                    icon={Calendar}
                    label="Released"
                    value={
                      artifact?.releasedAt ? formatDate(artifact.releasedAt) : MISSING
                    }
                  />
                  <SpecRow
                    icon={FileArchive}
                    label="File name"
                    value={artifact?.fileName ?? appRelease.fileName}
                  />
                </div>
              </section>

              {/* your account */}
              <section
                aria-labelledby="account-heading"
                className="rounded-lg glass neon-border p-6"
              >
                <h2
                  id="account-heading"
                  className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
                >
                  <ShieldCheck className="h-4 w-4 text-red-400" aria-hidden="true" />
                  Authorised as
                </h2>

                <div className="mt-4 flex items-center gap-3.5">
                  <Avatar className="h-11 w-11">
                    {user.image ? (
                      <AvatarImage
                        src={user.image}
                        alt={user.name}
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <AvatarFallback>{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-zinc-200">
                      {user.name}
                    </p>
                    <p className="truncate font-mono text-[10.5px] text-zinc-500">
                      {user.email}
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                      Downloads
                    </span>
                    <span className="font-mono text-[11.5px] font-semibold text-red-400">
                      {downloadCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                      Last download
                    </span>
                    <span className="font-mono text-[11.5px] text-zinc-300">
                      {lastDownloadAt ? timeAgo(lastDownloadAt) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                      Member since
                    </span>
                    <span className="font-mono text-[11.5px] text-zinc-300">
                      {formatDateTime(user.createdAt)}
                    </span>
                  </div>
                </div>
              </section>

              {/* download history */}
              <section
                aria-labelledby="history-heading"
                className="rounded-lg glass neon-border"
              >
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
                  <h2
                    id="history-heading"
                    className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
                  >
                    <History className="h-4 w-4 text-red-400" aria-hidden="true" />
                    Audit log
                  </h2>
                  <Badge variant="secondary">
                    {downloadCount} entr{downloadCount === 1 ? "y" : "ies"}
                  </Badge>
                </div>

                <DownloadHistory userId={user.id} />
              </section>
            </div>
          </div>

          {/* ==================================================================
              SUPPORT STRIP
              ================================================================== */}
          <div
            className={cn(
              "mt-8 rounded-lg border border-white/[0.07] bg-white/[0.015] p-6",
            )}
          >
            <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Trouble installing?
                </h2>
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-zinc-500">
                  Most issues are the unknown-sources permission or a stale
                  session. Sign out and back in to refresh your member token,
                  then retry the download.
                </p>
              </div>
              <div className="flex shrink-0 gap-3">
                <Link href="/dashboard">
                  <Button variant="cyber" size="sm">
                    Back to dashboard
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button variant="outline" size="sm">
                    Contact support
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

/* ==========================================================================
   HISTORY (server component — keeps the query on the server)
   ========================================================================== */

async function DownloadHistory({ userId }: { userId: string }) {
  const { prisma } = await import("@/lib/prisma");

  const logs = await prisma.downloadLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      version: true,
      platform: true,
      createdAt: true,
    },
  });

  if (logs.length === 0) {
    return (
      <div className="px-6 py-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-600">
          No downloads recorded yet
        </p>
        <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-zinc-500">
          Your first download will appear here with a timestamp and build
          version.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.05]">
      {logs.map((log) => (
        <li
          key={log.id}
          className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-red-500/[0.035]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <FileArchive
              className="h-3.5 w-3.5 shrink-0 text-red-500/70"
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block truncate font-mono text-[11.5px] text-zinc-300">
                {appRelease.fileName}
              </span>
              <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-wider text-zinc-600">
                {log.platform} · v{log.version}
              </span>
            </span>
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {timeAgo(log.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
