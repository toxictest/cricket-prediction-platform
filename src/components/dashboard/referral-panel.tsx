"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Share2, UserPlus, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initials, cn } from "@/lib/utils";

export type ReferralEntry = {
  id: string;
  name: string;
  image: string | null;
  /** Pre-formatted join date (formatting happens on the server). */
  joinedAt: string;
};

const VISIBLE_LIMIT = 6;

/**
 * Referral network panel.
 *
 * Displays the members attributed to the current user. Only the six most
 * recent are sent from the server; the footer reports the true total so the
 * card never misrepresents the network size.
 */
export function DashboardReferrals({
  referrals,
  total,
}: {
  referrals: ReferralEntry[];
  total: number;
}) {
  const reduce = useReducedMotion();
  const hidden = Math.max(total - referrals.length, 0);

  async function handleShare() {
    const shareData = {
      title: "Cricket Prediction Community",
      text: "Join the cricket prediction network — register and unlock the Android terminal.",
      url: window.location.origin + "/register",
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareData.url);
    } catch {
      // The user dismissed the sheet, or the clipboard is unavailable — the
      // referral link is already visible on the card above.
    }
  }

  return (
    <section
      aria-labelledby="network-heading"
      className="rounded-lg glass neon-border"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
        <h2
          id="network-heading"
          className="flex items-center gap-2.5 font-display text-base font-semibold text-white"
        >
          <Users className="h-4 w-4 text-red-400" aria-hidden="true" />
          Your network
        </h2>

        <Badge variant={total > 0 ? "neon" : "secondary"}>
          {total} member{total === 1 ? "" : "s"}
        </Badge>
      </div>

      {referrals.length === 0 ? (
        /* ---------------- empty state ---------------- */
        <div className="px-6 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03]">
            <UserPlus className="h-5 w-5 text-zinc-600" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-sm font-semibold text-zinc-300">
            No referrals yet
          </p>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-zinc-500">
            Share your referral link and the first member to register through it
            will appear here instantly.
          </p>
          <Button
            variant="cyber"
            size="sm"
            className="mt-5"
            onClick={handleShare}
          >
            <Share2 aria-hidden="true" />
            Share invite
          </Button>
        </div>
      ) : (
        /* ---------------- list ---------------- */
        <>
          <ul className="divide-y divide-white/[0.05]">
            {referrals.slice(0, VISIBLE_LIMIT).map((entry, index) => (
              <motion.li
                key={entry.id}
                initial={reduce ? undefined : { opacity: 0, x: -12 }}
                animate={reduce ? undefined : { opacity: 1, x: 0 }}
                transition={{
                  delay: index * 0.06,
                  duration: 0.4,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="flex items-center gap-3.5 px-6 py-3.5 transition-colors hover:bg-red-500/[0.035]"
              >
                <Avatar className="h-9 w-9 rounded">
                  {entry.image ? (
                    <AvatarImage
                      src={entry.image}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                  <AvatarFallback className="rounded text-[11px]">
                    {initials(entry.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-zinc-200">
                    {entry.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    Joined {entry.joinedAt}
                  </p>
                </div>

                <Badge variant="success" className="shrink-0">
                  Active
                </Badge>
              </motion.li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              {hidden > 0
                ? `+ ${hidden} more member${hidden === 1 ? "" : "s"}`
                : "Showing everyone"}
            </p>
            <button
              type="button"
              onClick={handleShare}
              className={cn(
                "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                "text-zinc-500 transition-colors hover:text-red-400",
              )}
            >
              <Share2 className="h-3 w-3" aria-hidden="true" />
              Share invite
            </button>
          </div>
        </>
      )}

      <noscript>
        <p className="border-t border-white/[0.06] px-6 py-3 text-[12px] text-zinc-500">
          Copy your referral link from the card above and share it manually.
          <Link href="/download" className="ml-1 text-red-400 underline">
            Go to Download Center
          </Link>
        </p>
      </noscript>
    </section>
  );
}

export default DashboardReferrals;
