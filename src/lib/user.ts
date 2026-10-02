import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateUniqueReferralCode, resolveReferrerId } from "@/lib/referral";

/* ==========================================================================
   TYPES
   ========================================================================== */

export type ProvisionInput = {
  /** Google `sub` claim, or a namespaced synthetic id for developer sign-in. */
  googleId: string;
  name: string;
  email: string;
  image?: string | null;
  /** Referral code captured from the `cpc_ref` cookie / `?ref=` query param. */
  referralCode?: string | null;
};

export type ProvisionResult = {
  user: User;
  /** True when this call created the row (i.e. first-ever registration). */
  created: boolean;
  /** True when a referral link was successfully established. */
  referred: boolean;
};

/** Aggregate view backing the dashboard. */
export type UserOverview = {
  user: User;
  referralCount: number;
  referrals: Array<Pick<User, "id" | "name" | "image" | "createdAt">>;
  downloadCount: number;
  lastDownloadAt: Date | null;
};

/* ==========================================================================
   NORMALISATION
   ========================================================================== */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Google returns the display name in the locale of the account. Guard against
 * empty/whitespace values so `User.name` (NOT NULL) never receives junk.
 */
function normalizeName(name: string | null | undefined, email: string): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) return trimmed.slice(0, 120);
  return email.split("@")[0]?.slice(0, 120) || "Member";
}

/** Only persist avatar URLs we can actually render (`next.config.ts` allows lh3). */
function normalizeImage(image: string | null | undefined): string | null {
  if (!image) return null;
  const trimmed = image.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/* ==========================================================================
   PROVISIONING (called from the NextAuth `signIn` callback)
   ========================================================================== */

/**
 * Creates or refreshes the database record for an authenticated identity.
 *
 * Flow:
 *  1. Look the account up by `googleId`, falling back to `email` so that a
 *     member who first used developer access can later link real Google.
 *  2. Existing rows get their profile refreshed and `lastLoginAt` bumped.
 *  3. New rows are inserted with a crypto-random, collision-checked referral
 *     code and an optional referrer attribution.
 *
 * The whole operation is wrapped in a retry loop: `referralCode` and `googleId`
 * are `@unique`, so a concurrent sign-up can race us past the pre-check. Any
 * P2002 becomes a retry with a freshly generated code rather than a 500.
 */
export async function provisionUser(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name, email);
  const image = normalizeImage(input.image);
  const googleId = input.googleId.trim();

  if (!googleId) throw new Error("provisionUser: googleId is required");
  if (!email) throw new Error("provisionUser: email is required");

  const existing = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
    select: { id: true, googleId: true, email: true, referredById: true },
  });

  // ---------------------------------------------------------------------
  // Path A — returning member
  // ---------------------------------------------------------------------
  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        // Re-bind googleId when the row was originally created by another
        // provider for the same verified email address.
        ...(existing.googleId !== googleId ? { googleId } : {}),
        name,
        image,
        lastLoginAt: new Date(),
      },
    });

    // A member referred by someone else before their record existed keeps
    // that attribution; we only attempt linking for brand-new relationships.
    let referred = false;
    if (!existing.referredById && input.referralCode) {
      const referrerId = await resolveReferrerId(input.referralCode, email);
      if (referrerId && referrerId !== user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { referredById: referrerId },
        });
        referred = true;
      }
    }

    return { user: { ...user, referredById: referred ? user.referredById : existing.referredById }, created: false, referred };
  }

  // ---------------------------------------------------------------------
  // Path B — first registration
  // ---------------------------------------------------------------------
  const referrerId = await resolveReferrerId(input.referralCode, email);

  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const referralCode = await generateUniqueReferralCode();

    try {
      const user = await prisma.user.create({
        data: {
          googleId,
          name,
          email,
          image,
          referralCode,
          referredById: referrerId,
          lastLoginAt: new Date(),
        },
      });
      return { user, created: true, referred: Boolean(referrerId) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = (error.meta?.target as string[] | undefined) ?? [];

        // Someone registered this exact googleId/email between our SELECT
        // and INSERT — re-resolve and take Path A on the next pass.
        if (target.includes("googleId") || target.includes("email")) {
          const raced = await prisma.user.findFirst({
            where: { OR: [{ googleId }, { email }] },
          });
          if (raced) {
            const user = await prisma.user.update({
              where: { id: raced.id },
              data: { name, image, lastLoginAt: new Date() },
            });
            return { user, created: false, referred: false };
          }
        }

        // Otherwise it was a referralCode collision: loop and regenerate.
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    "provisionUser: unable to allocate a unique referral code after 6 attempts",
  );
}

/* ==========================================================================
   READS
   ========================================================================== */

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

/** Everything the dashboard needs, in a single round of queries. */
export async function getUserOverview(id: string): Promise<UserOverview | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;

  const [referralCount, referrals, downloadAggregate, lastDownload] =
    await Promise.all([
      prisma.user.count({ where: { referredById: id } }),
      prisma.user.findMany({
        where: { referredById: id },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, name: true, image: true, createdAt: true },
      }),
      prisma.downloadLog.count({ where: { userId: id } }),
      prisma.downloadLog.findFirst({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  return {
    user,
    referralCount,
    referrals,
    downloadCount: downloadAggregate,
    lastDownloadAt: lastDownload?.createdAt ?? null,
  };
}

/* ==========================================================================
   WRITES
   ========================================================================== */

export async function recordDownload(input: {
  userId: string;
  version: string;
  platform?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  return prisma.downloadLog.create({
    data: {
      userId: input.userId,
      version: input.version,
      platform: input.platform ?? "android",
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true, createdAt: true, version: true },
  });
}
