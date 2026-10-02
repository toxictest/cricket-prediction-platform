import type { NextAuthOptions } from "next-auth";
import { cookies } from "next/headers";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { provisionUser, normalizeEmail } from "@/lib/user";

/** Cookie that carries a referral code across the OAuth round-trip. */
export const REFERRAL_COOKIE = "cpc_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/* ==========================================================================
   HELPERS
   ========================================================================== */

/**
 * Reads the referral code captured by the middleware.
 *
 * `next/headers` is request-scoped, and the NextAuth callbacks run inside the
 * `/api/auth/[...nextauth]` route handler, so the store is available. We still
 * guard with try/catch because the same options object is also imported by
 * tooling (e.g. `getServerSession` in RSC) where no cookie store exists.
 */
async function readReferralCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(REFERRAL_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Best-effort cookie cleanup; never let this break a successful sign-in. */
async function clearReferralCookie(): Promise<void> {
  try {
    const store = await cookies();
    if (store.has(REFERRAL_COOKIE)) store.delete(REFERRAL_COOKIE);
  } catch {
    /* no-op */
  }
}

/* ==========================================================================
   PROVIDERS
   ========================================================================== */

const providers: NextAuthOptions["providers"] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    // We already receive the verified email from Google; asking for offline
    // access would only add an unnecessary refresh-token liability.
    authorization: {
      params: {
        prompt: "select_account",
        access_type: "online",
        scope: "openid email profile",
      },
    },
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.email?.split("@")[0] ?? "Member",
        email: profile.email,
        image: profile.picture ?? null,
      };
    },
  }),
];

/* ==========================================================================
   OPTIONS
   ========================================================================== */

export const authOptions: NextAuthOptions = {
  providers,

  secret: process.env.NEXTAUTH_SECRET,

  // JWT sessions keep the edge middleware stateless and let us run a lean
  // User table (no Account/Session tables required by the adapter).
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // refresh the token fingerprint daily
  },

  jwt: {
    maxAge: 30 * 24 * 60 * 60,
  },

  // NOTE: `useSecureCookies` is deliberately NOT overridden here.
  //
  // NextAuth derives the session cookie name from the protocol of
  // `NEXTAUTH_URL`:
  //   http://…  → "next-auth.session-token"
  //   https://… → "__Secure-next-auth.session-token"
  //
  // `next-auth/middleware` performs the SAME derivation internally, and it has
  // no way to receive our cookie configuration. Overriding `useSecureCookies`
  // from `NODE_ENV` therefore desynchronises the two: a production build served
  // over plain HTTP wrote `__Secure-*` cookies while the middleware looked for
  // the unprefixed name, so every gated route bounced to /login in a loop.
  // Leaving it undefined keeps the server and the edge in lockstep, and a real
  // HTTPS deployment still gets the hardened cookie automatically.

  pages: {
    signIn: "/login",
    error: "/login",
    newUser: "/register",
  },

  callbacks: {
    /**
     * Runs before a session token is issued. This is where the PostgreSQL
     * record is created/refreshed, and the only place that can reject a login.
     */
    async signIn({ user, account }) {
      try {
        const email = user.email;
        if (!email) return false;

        const googleId =
          account?.provider === "google"
            ? (account.providerAccountId ?? user.id)
            : user.id;

        const referralCode = await readReferralCookie();

        await provisionUser({
          googleId,
          email,
          name: user.name ?? email.split("@")[0] ?? "Member",
          image: user.image,
          referralCode,
        });

        if (referralCode) await clearReferralCookie();
        return true;
      } catch (error) {
        console.error("[auth] signIn provisioning failed:", error);
        return false;
      }
    },

    /**
     * Shapes the token. On first sign-in we hydrate the custom claims from the
     * database; on subsequent requests we refresh them at most once per day so
     * referral counts shown in the UI stay close to real time without a query
     * on every request.
     */
    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);

      if (user?.email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: normalizeEmail(user.email) },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            referralCode: true,
            createdAt: true,
          },
        });

        if (dbUser) {
          token.uid = dbUser.id;
          token.name = dbUser.name;
          token.email = dbUser.email;
          token.picture = dbUser.image;
          token.referralCode = dbUser.referralCode;
          token.registeredAt = dbUser.createdAt.toISOString();
          token.syncedAt = now;
        }
        token.provider = "google";
        return token;
      }

      const lastSync = typeof token.syncedAt === "number" ? token.syncedAt : 0;
      const STALE_AFTER = 60 * 60 * 24; // 24h

      if (trigger === "update" || now - lastSync > STALE_AFTER) {
        const uid = typeof token.uid === "string" ? token.uid : null;
        if (uid) {
          const dbUser = await prisma.user.findUnique({
            where: { id: uid },
            select: {
              name: true,
              image: true,
              referralCode: true,
              createdAt: true,
            },
          });
          if (dbUser) {
            token.name = dbUser.name;
            token.picture = dbUser.image;
            token.referralCode = dbUser.referralCode;
            token.registeredAt = dbUser.createdAt.toISOString();
          } else {
            // The account was deleted while the JWT was still valid.
            token.uid = undefined;
          }
        }
        token.syncedAt = now;
      }

      return token;
    },

    /** Projects the token onto the object returned by `useSession()`. */
    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: (token.uid as string | undefined) ?? "",
        name: (token.name as string | undefined) ?? session.user?.name ?? "",
        email: (token.email as string | undefined) ?? session.user?.email ?? "",
        image: (token.picture as string | null | undefined) ?? null,
        referralCode: (token.referralCode as string | undefined) ?? "",
        registeredAt: (token.registeredAt as string | undefined) ?? "",
      };
      return session;
    },

    /**
     * Only same-origin paths may be used as post-login destinations.
     * Blocks the classic `callbackUrl=https://evil.tld` open-redirect.
     */
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const parsed = new URL(url);
        if (parsed.origin === baseUrl) return url;
      } catch {
        /* fall through */
      }
      return `${baseUrl}/dashboard`;
    },
  },

  events: {
    async signIn({ user, isNewUser }) {
      console.info(
        `[auth] sign-in ok user=${user.email} new=${Boolean(isNewUser)}`,
      );
    },
    async signOut() {
      // JWT strategy: nothing to revoke server-side.
    },
  },

  debug: false,
};

/** True when Google credentials are present, so the UI can warn early. */
export const googleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

