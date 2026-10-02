import type { DefaultSession } from "next-auth";

/**
 * Module augmentation so the custom claims minted in `callbacks.jwt` /
 * `callbacks.session` (see `src/lib/auth.ts`) are fully typed on the server
 * and inside `useSession()` on the client.
 */
declare module "next-auth" {
  interface Session {
    user: {
      /** Prisma `User.id` (cuid). Empty string when the JWT is unhydrated. */
      id: string;
      /** Unique, shareable referral code, e.g. "CRC-7K2M9QX4". */
      referralCode: string;
      /** ISO timestamp of the original registration. */
      registeredAt: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    referralCode?: string;
    registeredAt?: string;
    /** Unix seconds of the last database re-hydration. */
    syncedAt?: number;
    provider?: string;
  }
}
