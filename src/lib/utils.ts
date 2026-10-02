import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names while resolving Tailwind conflicts
 * (last-wins semantics). Used by every UI primitive in `components/ui`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a date as an ISO-ish, locale-aware label, e.g. "02 Oct 2026". */
export function formatDate(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  },
): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", options).format(value);
}

/** Format a date with time, e.g. "02 Oct 2026, 14:35". */
export function formatDateTime(date: Date | string | null | undefined): string {
  return formatDate(date, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 days ago", "just now" — used on activity rows. */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - value.getTime()) / 1000);

  if (seconds < 45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secondsInUnit] of units) {
    const amount = Math.floor(seconds / secondsInUnit);
    if (amount >= 1) return formatter.format(-amount, unit);
  }
  return "just now";
}

/** Mask an email for screenshots / support logs: jo**@gmail.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
}

/** Absolute URL builder that works in the browser, on the server and on Vercel. */
export function absoluteUrl(path = ""): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : null;

  const base = configured || vercel || "http://localhost:3000";

  const normalizedBase = base.replace(/\/+$/, "");

  // No path supplied → return the bare origin, without a trailing slash.
  if (!path) return normalizedBase;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/** Deterministic initials for avatar fallbacks. */
export function initials(name?: string | null): string {
  if (!name) return "??";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Thin, dependency-free sleep helper for staggered UI reveals. */
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Stable, copy-safe id for aria attributes in client components. */
export function uid(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
