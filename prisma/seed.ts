/**
 * ============================================================================
 * Database seed
 * ============================================================================
 * Creates a small, deterministic member network so the dashboard, referral
 * panel and tier progress can be inspected without going through OAuth
 * repeatedly.
 *
 *   npm run db:seed
 *
 * Idempotent: re-running updates existing rows by `googleId`/`email` rather
 * than duplicating them. Safe to run against a development database at any
 * time — but NEVER point it at production.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

/* ---------------------------------------------------------------------------
   Referral code generation (mirrors src/lib/referral.ts so seeds look real)
   --------------------------------------------------------------------------- */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateReferralCode(prefix = "CRC", length = 8): string {
  const bytes = randomBytes(length);
  let body = "";
  for (let i = 0; i < length; i += 1) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

/* ---------------------------------------------------------------------------
   Fixtures
   --------------------------------------------------------------------------- */

type SeedMember = {
  googleId: string;
  name: string;
  email: string;
  image: string | null;
  referralCode: string;
  referredByEmail?: string;
  /** Days ago the account was created. */
  createdDaysAgo: number;
  downloadCount: number;
};

const MEMBERS: SeedMember[] = [
  {
    googleId: "seed_104390847120938475610",
    name: "Aarav Mehta",
    email: "aarav.mehta@example.com",
    image: null,
    referralCode: "CRC-ARCH1TEC",
    createdDaysAgo: 210,
    downloadCount: 4,
  },
  {
    googleId: "seed_118273645509182736455",
    name: "Priya Nair",
    email: "priya.nair@example.com",
    image: null,
    referralCode: "CRC-ANALY5T",
    referredByEmail: "aarav.mehta@example.com",
    createdDaysAgo: 96,
    downloadCount: 2,
  },
  {
    googleId: "seed_109283746556473829102",
    name: "Rohan Verma",
    email: "rohan.verma@example.com",
    image: null,
    referralCode: "CRC-STRAT3GY",
    referredByEmail: "aarav.mehta@example.com",
    createdDaysAgo: 74,
    downloadCount: 3,
  },
  {
    googleId: "seed_122334455667788990011",
    name: "Ishita Rao",
    email: "ishita.rao@example.com",
    image: null,
    referralCode: "CRC-RECRU1T",
    referredByEmail: "aarav.mehta@example.com",
    createdDaysAgo: 41,
    downloadCount: 1,
  },
  {
    googleId: "seed_155667788990011223344",
    name: "Kabir Singh",
    email: "kabir.singh@example.com",
    image: null,
    referralCode: "CRC-S1GNAL9",
    referredByEmail: "priya.nair@example.com",
    createdDaysAgo: 28,
    downloadCount: 1,
  },
  {
    googleId: "seed_177889900112233445566",
    name: "Ananya Iyer",
    email: "ananya.iyer@example.com",
    image: null,
    referralCode: "CRC-N3TW0RK7",
    referredByEmail: "rohan.verma@example.com",
    createdDaysAgo: 12,
    downloadCount: 0,
  },
  {
    googleId: "seed_199001122334455667788",
    name: "Dev Malhotra",
    email: "dev.malhotra@example.com",
    image: null,
    referralCode: "CRC-D3LTAB0X",
    referredByEmail: "priya.nair@example.com",
    createdDaysAgo: 5,
    downloadCount: 0,
  },
];

const DOWNLOAD_VERSIONS = ["1.0.0", "1.0.0", "0.9.4", "0.9.3"];
const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
];

const daysAgo = (days: number, hourOffset = 0) =>
  new Date(Date.now() - days * 86_400_000 - hourOffset * 3_600_000);

/* ---------------------------------------------------------------------------
   Main
   --------------------------------------------------------------------------- */

async function main() {
  console.log("▸ seeding database…\n");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV is 'production'. Seeds are development-only.",
    );
  }

  // ---- pass 1: upsert every member without referral links ---------------
  for (const member of MEMBERS) {
    const createdAt = daysAgo(member.createdDaysAgo, member.createdDaysAgo % 12);

    await prisma.user.upsert({
      where: { googleId: member.googleId },
      update: {
        name: member.name,
        email: member.email,
        image: member.image,
        referralCode: member.referralCode,
        lastLoginAt: daysAgo(Math.max(1, Math.floor(member.createdDaysAgo / 30))),
      },
      create: {
        googleId: member.googleId,
        name: member.name,
        email: member.email,
        image: member.image,
        referralCode: member.referralCode,
        createdAt,
        lastLoginAt: daysAgo(Math.max(1, Math.floor(member.createdDaysAgo / 30))),
      },
    });

    console.log(`  ✔ member  ${member.name.padEnd(16)} ${member.referralCode}`);
  }

  // ---- pass 2: wire up referral attribution ------------------------------
  for (const member of MEMBERS) {
    if (!member.referredByEmail) continue;

    const referrer = await prisma.user.findUnique({
      where: { email: member.referredByEmail },
      select: { id: true },
    });

    if (!referrer) {
      console.warn(
        `  ! referrer ${member.referredByEmail} not found for ${member.name}`,
      );
      continue;
    }

    await prisma.user.update({
      where: { email: member.email },
      data: { referredById: referrer.id },
    });

    console.log(
      `  ↔ referral ${member.name.padEnd(16)} ← ${member.referredByEmail.split("@")[0]}`,
    );
  }

  // ---- pass 3: download audit logs ---------------------------------------
  await prisma.downloadLog.deleteMany({
    where: { user: { googleId: { startsWith: "seed_" } } },
  });

  let logCount = 0;

  for (const member of MEMBERS) {
    if (member.downloadCount === 0) continue;

    const user = await prisma.user.findUnique({
      where: { email: member.email },
      select: { id: true },
    });
    if (!user) continue;

    for (let i = 0; i < member.downloadCount; i += 1) {
      await prisma.downloadLog.create({
        data: {
          userId: user.id,
          version: DOWNLOAD_VERSIONS[i % DOWNLOAD_VERSIONS.length]!,
          platform: "android",
          userAgent: USER_AGENTS[i % USER_AGENTS.length]!,
          ipHash: randomBytes(20).toString("hex"),
          createdAt: daysAgo(
            Math.max(1, member.createdDaysAgo - i * 7),
            i * 5,
          ),
        },
      });
      logCount += 1;
    }
  }

  console.log(`\n  ✔ ${logCount} download log entr${logCount === 1 ? "y" : "ies"}`);

  // ---- summary ------------------------------------------------------------
  const [userCount, referralCount, downloadTotal] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { referredById: { not: null } } }),
    prisma.downloadLog.count(),
  ]);

  console.log("\n── summary ──────────────────────────────");
  console.log(`   users          ${userCount}`);
  console.log(`   referred users ${referralCount}`);
  console.log(`   download logs  ${downloadTotal}`);
  console.log("─────────────────────────────────────────\n");

  console.log("Sign in with Developer Access using any seeded email,");
  console.log("e.g. aarav.mehta@example.com\n");
}

main()
  .catch((error) => {
    console.error("\n✖ seed failed\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
