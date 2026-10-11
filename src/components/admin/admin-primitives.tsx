import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/* ==========================================================================
   ADMIN PRIMITIVES
   ==========================================================================

   The shapes every queue page needs, in one file, so the payment queue, the
   payout queue and the match console cannot drift into three different-looking
   tables that merely share a stylesheet.
   ========================================================================== */

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-red-500/80">
          {eyebrow}
        </p>
        <h1 className="mt-2.5 text-balance font-display text-[1.7rem] font-extrabold leading-tight text-white sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-pretty text-[14px] leading-relaxed text-zinc-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function AdminCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-lg border border-white/[0.07] p-5 glass sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "red",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "red" | "emerald" | "amber" | "cyan" | "zinc";
}) {
  const tones = {
    red: "text-red-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    cyan: "text-cyan-400",
    zinc: "text-zinc-400",
  } as const;

  return (
    <div className="group relative rounded-lg border border-white/[0.07] p-4 transition-colors glass hover:border-red-500/30">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          {label}
        </p>
        <Icon className={cn("h-4 w-4 shrink-0", tones[tone])} aria-hidden="true" />
      </div>
      <p className="mt-3 font-display text-2xl font-extrabold leading-none text-white tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * One badge for every status word the panel shows. The vocabulary is the
 * database's (`PaymentStatus`, `WithdrawalStatus`, `MatchStatus`), so an
 * unexpected value renders as a neutral pill instead of crashing a queue page.
 */
const STATUS_STYLE: Record<
  string,
  { variant: NonNullable<React.ComponentProps<typeof Badge>["variant"]>; label: string }
> = {
  PENDING: { variant: "warning", label: "Pending" },
  APPROVED: { variant: "success", label: "Approved" },
  REJECTED: { variant: "destructive", label: "Rejected" },
  UPCOMING: { variant: "info", label: "Upcoming" },
  LIVE: { variant: "default", label: "Live" },
  COMPLETED: { variant: "secondary", label: "Completed" },
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { variant: "secondary" as const, label: status };
  return (
    <Badge variant={style.variant} className={status === "LIVE" ? "animate-pulse" : undefined}>
      {style.label}
    </Badge>
  );
}

/** Tokens, signed and tabular, the way a ledger reads. */
export function TokenValue({ amount, className }: { amount: number; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[13px] font-semibold tabular-nums",
        amount > 0 ? "text-emerald-300" : amount < 0 ? "text-red-300" : "text-zinc-400",
        className,
      )}
    >
      {amount > 0 ? "+" : ""}
      {amount.toLocaleString("en-IN")}
    </span>
  );
}

/** Rupees, as the claim was filed. */
export function RupeeValue({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cn("font-mono text-[13px] font-semibold tabular-nums text-white", className)}>
      ₹{amount.toLocaleString("en-IN")}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]">
        <Icon className="h-5 w-5 text-zinc-500" aria-hidden="true" />
      </span>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">
        {title}
      </p>
      <p className="max-w-sm text-[13px] leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}

/**
 * What a page renders when the signed-in admin may not see it. Deliberately not
 * a redirect: bouncing a wrong-role admin would loop them back to a page their
 * own layout lets them stand on.
 */
export function AdminAccessNotice({
  title,
  body,
  roles,
}: {
  title: string;
  body: string;
  roles?: string[];
}) {
  return (
    <AdminCard className="mx-auto max-w-xl">
      <div className="flex flex-col items-start gap-3">
        <Badge variant="warning">Restricted</Badge>
        <h2 className="font-display text-lg font-extrabold text-white">{title}</h2>
        <p className="text-[13.5px] leading-relaxed text-zinc-400">{body}</p>
        {roles && roles.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
            needs one of: {roles.join(" · ")}
          </p>
        )}
      </div>
    </AdminCard>
  );
}

/** Label + control + the small print an operator needs before typing. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] font-medium text-red-300">{error}</p>
      ) : (
        hint && <p className="text-[11.5px] leading-relaxed text-zinc-500">{hint}</p>
      )}
    </div>
  );
}
