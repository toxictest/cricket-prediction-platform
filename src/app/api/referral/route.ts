import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateReferralCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Referral codes are at least 4 characters")
    .max(24, "Referral codes are at most 24 characters"),
});

/* --------------------------------------------------------------------------
   Simple in-memory sliding-window limiter.
   Guards the endpoint against code-enumeration scraping.

   ── Two production caveats ────────────────────────────────────────────────

   1. PER-PROCESS STATE. The Map lives in one Node process. With N replicas
      behind a load balancer the effective limit becomes N × MAX_REQUESTS, and
      the bucket resets on every deploy. Swap the Map for Redis
      (`@upstash/ratelimit`) — the interface below stays identical.

   2. HEADER TRUST. The client key comes from `x-forwarded-for`, which a caller
      can set themselves. If this app is reachable directly (no proxy) an
      attacker can rotate the header and bypass the limit entirely. Two safe
      deployments:
        • Terminate at a proxy/CDN that OVERWRITES `x-forwarded-for` (Vercel,
          Cloudflare, nginx with `proxy_set_header`), or
        • Prefer the platform-provided address when available. On Vercel, use
          `request.headers.get("x-vercel-forwarded-for")` or `request.ip`.
      The header is read first here because it also makes the limit testable.
   -------------------------------------------------------------------------- */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const buckets = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (hits.length >= MAX_REQUESTS) {
    buckets.set(key, hits);
    return true;
  }

  hits.push(now);
  buckets.set(key, hits);

  // Opportunistic cleanup so the Map cannot grow unbounded.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t > WINDOW_MS)) buckets.delete(k);
    }
  }
  return false;
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * GET /api/referral?code=CRC-7K2M9QX4
 *
 * Public, read-only validation used by the register form to give instant
 * feedback while the invitee types. It reveals only the referrer's *first
 * name* — never their email, id or any other column.
 */
export async function GET(request: NextRequest) {
  if (rateLimited(clientKey(request))) {
    return NextResponse.json(
      { ok: false, error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const parsed = querySchema.safeParse({
    code: request.nextUrl.searchParams.get("code") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid code",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const result = await validateReferralCode(parsed.data.code);

  if (!result.valid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.reason === "malformed"
            ? "That referral code is not formatted correctly."
            : "No member is using that referral code.",
        code: "NOT_FOUND",
        details: { code: result.code, reason: result.reason },
      },
      { status: 404 },
    );
  }

  const firstName = result.referrerName.split(/\s+/)[0] ?? "A member";

  return NextResponse.json(
    {
      ok: true,
      data: { code: result.code, referrerFirstName: firstName },
    },
    { status: 200 },
  );
}
