/**
 * Formatting, without leaning on Intl.
 *
 * Hermes ships an Intl that is complete enough for `NumberFormat` on current
 * releases, but "complete enough" has historically meant a device on an older
 * runtime rendering `1250` where every other phone renders `1,250`. Grouping by
 * thousands is nine lines, and the Indian digit grouping (1,25,000) is what this
 * audience expects for rupees anyway — which `Intl` gets wrong unless you ask it
 * for `en-IN` on every call.
 */

function group(digits: string, size: number, lead: number): string {
  const head = digits.slice(0, lead);
  const tail = digits.slice(lead);
  const parts: string[] = [];
  for (let i = tail.length; i > 0; i -= size) parts.unshift(tail.slice(Math.max(0, i - size), i));
  return [head, ...parts].filter(Boolean).join(",");
}

/** 1250000 → "12,50,000" — the last group is 3, the ones above it are 2. */
export function formatIndian(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  if (digits.length <= 3) return `${negative ? "-" : ""}${digits}`;
  return `${negative ? "-" : ""}${group(digits, 2, digits.length % 2 || 2)}`;
}

/** Tokens are whole numbers. Never decimals: the backend stores integers. */
export function formatTokens(value: number): string {
  return `${formatIndian(value)} tokens`;
}

export function formatRupees(value: number): string {
  return `₹${formatIndian(value)}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}, ${time}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "182/4" + "16.3" → the one line a scoreboard row needs. */
export function scoreLine(teamAScore: string, teamBScore: string, currentOver: string): string {
  const left = teamAScore || "—";
  const right = teamBScore && teamBScore !== "0/0" ? ` · ${teamBScore}` : "";
  return `${left}${right} · ${currentOver || "—"}`;
}
