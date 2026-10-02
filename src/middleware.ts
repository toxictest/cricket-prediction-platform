import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { getToken } from "next-auth/jwt";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";

/* ==========================================================================
   ROUTE CLASSIFICATION
   ========================================================================== */

/** Routes that require an authenticated, database-backed member session. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/download",
  "/downloads", // the static APK payload itself
  "/account",
  "/settings",
  "/referrals",
] as const;

/** Auth screens — an already-signed-in member is bounced to the dashboard. */
const AUTH_ROUTES = ["/login", "/register"] as const;

/**
 * Paths that must NEVER be interrupted by the auth wrapper:
 *  - /api/auth/*   NextAuth's own callback endpoints
 *  - /api/health   uptime probe used by orchestrators
 *  - static assets, fonts and image optimisation
 */
const BYPASS_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/_next",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/manifest.webmanifest",
] as const;

const REFERRAL_COOKIE = "cpc_ref";
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const REFERRAL_PATTERN = /^[A-Za-z0-9-]{4,24}$/;

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function isBypassed(pathname: string): boolean {
  return BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Normalise a `?ref=` value, returning `null` when it is not plausible. */
function readReferral(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !REFERRAL_PATTERN.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

/** Attach the referral cookie to an outgoing response. */
function withReferralCookie(
  response: NextResponse,
  code: string | null,
): NextResponse {
  if (!code) return response;

  response.cookies.set({
    name: REFERRAL_COOKIE,
    value: code,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
  });

  return response;
}

/** Only same-origin, relative paths may be used as a post-login destination. */
function safeCallbackUrl(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/* ==========================================================================
   PROTECTED-ROUTE GATE (consumed by `withAuth` below)
   ========================================================================== */

const authGate = withAuth(
  function middleware(_req: NextRequestWithAuth) {
    // Reached only for routes the gate has already authorised. Anything that
    // needs the decoded token can read it from `req.nextauth.token`; referral
    // capture and the auth-page bounce are handled by the composed middleware
    // above, which runs for the paths this callback can never observe.
    return NextResponse.next();
  },
  {
    // Static access to NEXTAUTH_SECRET so the value is inlined for the Edge
    // runtime instead of being looked up dynamically (which would be undefined).
    secret: process.env.NEXTAUTH_SECRET,

    pages: {
      signIn: "/login",
      error: "/login",
    },

    callbacks: {
      /**
       * Single source of truth for route access. Returning `false` makes
       * `withAuth` issue a 307 to `/login?callbackUrl=<original path>`.
       */
      authorized({ req, token }) {
        const { pathname } = req.nextUrl;

        if (isBypassed(pathname)) return true;
        if (isProtected(pathname)) return Boolean(token);
        return true;
      },
    },
  },
);

/* ==========================================================================
   COMPOSED MIDDLEWARE
   ========================================================================== */

/**
 * Runs ahead of `withAuth` for every matched route.
 *
 * Why the composition? `next-auth@4`'s internal `handleMiddleware` returns
 * early — *without* invoking the user callback — whenever the pathname equals
 * `pages.signIn` or `pages.error`:
 *
 *     if (startsWith(authPath) || [signInPage, errorPage].includes(pathname)) {
 *       return;
 *     }
 *
 * That bail-out is correct for a plain gate, but it also means the wrapped
 * callback can never bounce an already-authenticated member away from
 * `/login` or `/register`. A function passed to `withAuth` has no way to
 * intercept those paths, so the referral capture and the auth-page redirect
 * are handled here, before delegating to the gate.
 */
export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent,
): Promise<NextResponse | Response | undefined> {
  const { pathname, searchParams } = req.nextUrl;

  // ---- 0. infrastructure routes pass straight through -------------------
  if (isBypassed(pathname)) {
    return NextResponse.next();
  }

  // ---- 1. referral capture ---------------------------------------------
  // `?ref=CRC-XXXX` (or `?referral=`) is persisted to an httpOnly cookie so it
  // survives the OAuth round-trip, then consumed by `callbacks.signIn` while
  // the account is provisioned and cleared immediately afterwards.
  const referralCode = readReferral(
    searchParams.get("ref") ?? searchParams.get("referral"),
  );

  // ---- 2. signed-in members never need the auth screens -----------------
  if (isAuthRoute(pathname)) {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (token) {
      const destination =
        safeCallbackUrl(searchParams.get("callbackUrl")) ?? "/dashboard";

      const url = req.nextUrl.clone();
      url.pathname = destination.split("?")[0] ?? "/dashboard";
      url.search = "";
      return withReferralCookie(NextResponse.redirect(url), referralCode);
    }

    return withReferralCookie(NextResponse.next(), referralCode);
  }

  // ---- 3. everything else goes through the auth gate --------------------
  // `withAuth`'s public signature declares `NextRequestWithAuth`, but its
  // implementation accepts a plain request and injects `nextauth` itself
  // before invoking the callback. The cast reflects that runtime reality.
  const response = await authGate(req as NextRequestWithAuth, event);

  // The gate may return a redirect (unauthenticated) or a rewrite/next
  // response — attach the referral cookie either way.
  if (response instanceof NextResponse) {
    return withReferralCookie(response, referralCode);
  }
  if (response instanceof Response) {
    return withReferralCookie(NextResponse.next(), referralCode);
  }

  return withReferralCookie(NextResponse.next(), referralCode);
}

/* ==========================================================================
   MATCHER
   Excludes Next.js internals and any file request that looks like a static
   asset (has a dot in the final segment), so middleware never runs for CSS,
   JS chunks, fonts or images.
   ========================================================================== */

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff|woff2|ttf|otf|txt|xml|json)$).*)",
  ],
};
