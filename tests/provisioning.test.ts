import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { provisionUser, getUserOverview, normalizeEmail } from "@/lib/user";
import { generateUniqueReferralCode, validateReferralCode } from "@/lib/referral";

/**
 * Integration tests against the real PostgreSQL instance.
 *
 * Every fixture uses a unique `it_<timestamp>_` namespace and is torn down
 * afterwards, so the suite never collides with seeded or manual data and can be
 * run repeatedly against the same database.
 *
 * The whole file skips itself when the database is unreachable, keeping
 * `npm test` green on a clean checkout before `npm run db:setup`.
 */

const RUN = `it${Date.now()}`;
const createdUserIds: string[] = [];

/**
 * Resolved at MODULE LOAD, not in `beforeAll`.
 *
 * `describe.skipIf()` is evaluated during collection, before any hook runs —
 * so a flag flipped inside `beforeAll` would always read as `false` and every
 * test would silently skip. A top-level await is the reliable way to gate a
 * whole suite on an async precondition.
 */
const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn(
      "\n  ⚠ PostgreSQL unreachable — skipping provisioning tests." +
        "\n    Run `npm run db:setup` first.\n",
    );
    return false;
  });

afterAll(async () => {
  if (!dbAvailable) return;

  // Cascade removes the download logs; referral links detach via SET NULL.
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

/* ==========================================================================
   PROVISIONING
   ========================================================================== */

describe.skipIf(!dbAvailable)("provisionUser", () => {
  it("creates a member on first sign-in", async () => {
    const email = `${RUN}.new@example.test`;

    const result = await provisionUser({
      googleId: `${RUN}_google_new`,
      name: "New Member",
      email,
      image: "https://lh3.googleusercontent.com/a/test",
    });
    createdUserIds.push(result.user.id);

    expect(result.created).toBe(true);
    expect(result.user.email).toBe(email);
    expect(result.user.referralCode).toMatch(/^CRC-[A-Z0-9]{8}$/);
    expect(result.user.referredById).toBeNull();
    expect(result.user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("returns the same row on a repeat sign-in without duplicating", async () => {
    const email = `${RUN}.repeat@example.test`;

    const first = await provisionUser({
      googleId: `${RUN}_google_repeat`,
      name: "Repeat Member",
      email,
    });
    createdUserIds.push(first.user.id);

    const second = await provisionUser({
      googleId: `${RUN}_google_repeat`,
      name: "Renamed Member",
      email,
    });

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.name).toBe("Renamed Member");

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("lower-cases the email so lookups are case-insensitive", async () => {
    const result = await provisionUser({
      googleId: `${RUN}_google_case`,
      name: "Case Member",
      email: `${RUN}.CASE@Example.Test`,
    });
    createdUserIds.push(result.user.id);

    expect(result.user.email).toBe(`${RUN}.case@example.test`);
  });

  it("falls back to the email local-part when no name is supplied", async () => {
    const result = await provisionUser({
      googleId: `${RUN}_google_noname`,
      name: "   ",
      email: `${RUN}.noname@example.test`,
    });
    createdUserIds.push(result.user.id);

    expect(result.user.name).toBe(`${RUN}.noname`);
  });

  it("rejects a blank googleId and a blank email", async () => {
    await expect(
      provisionUser({ googleId: "  ", name: "X", email: `${RUN}.x@example.test` }),
    ).rejects.toThrow(/googleId is required/);

    await expect(
      provisionUser({ googleId: `${RUN}_google_y`, name: "X", email: "  " }),
    ).rejects.toThrow(/email is required/);
  });

  it("ignores a non-http avatar URL", async () => {
    const result = await provisionUser({
      googleId: `${RUN}_google_img`,
      name: "Image Member",
      email: `${RUN}.img@example.test`,
      image: "javascript:alert(1)",
    });
    createdUserIds.push(result.user.id);

    expect(result.user.image).toBeNull();
  });

  it("allocates a distinct referral code to every member", async () => {
    const codes = await Promise.all([
      provisionUser({
        googleId: `${RUN}_google_c1`,
        name: "C1",
        email: `${RUN}.c1@example.test`,
      }),
      provisionUser({
        googleId: `${RUN}_google_c2`,
        name: "C2",
        email: `${RUN}.c2@example.test`,
      }),
      provisionUser({
        googleId: `${RUN}_google_c3`,
        name: "C3",
        email: `${RUN}.c3@example.test`,
      }),
    ]);
    for (const r of codes) createdUserIds.push(r.user.id);

    const unique = new Set(codes.map((r) => r.user.referralCode));
    expect(unique.size).toBe(3);
  });
});

/* ==========================================================================
   REFERRAL ATTRIBUTION
   ========================================================================== */

describe.skipIf(!dbAvailable)("referral attribution", () => {
  it("links a new member to the owner of the referral code", async () => {
    const referrer = await provisionUser({
      googleId: `${RUN}_ref_owner`,
      name: "Referrer Owner",
      email: `${RUN}.owner@example.test`,
    });
    createdUserIds.push(referrer.user.id);

    const invitee = await provisionUser({
      googleId: `${RUN}_ref_invitee`,
      name: "Invited Member",
      email: `${RUN}.invitee@example.test`,
      referralCode: referrer.user.referralCode,
    });
    createdUserIds.push(invitee.user.id);

    expect(invitee.created).toBe(true);
    expect(invitee.referred).toBe(true);
    expect(invitee.user.referredById).toBe(referrer.user.id);
  });

  it("accepts a lower-case code (normalised before lookup)", async () => {
    const referrer = await provisionUser({
      googleId: `${RUN}_lc_owner`,
      name: "LC Owner",
      email: `${RUN}.lcowner@example.test`,
    });
    createdUserIds.push(referrer.user.id);

    const invitee = await provisionUser({
      googleId: `${RUN}_lc_invitee`,
      name: "LC Invitee",
      email: `${RUN}.lcinvitee@example.test`,
      referralCode: referrer.user.referralCode.toLowerCase(),
    });
    createdUserIds.push(invitee.user.id);

    expect(invitee.user.referredById).toBe(referrer.user.id);
  });

  it("BLOCKS self-referral", async () => {
    const member = await provisionUser({
      googleId: `${RUN}_self`,
      name: "Self Referrer",
      email: `${RUN}.self@example.test`,
    });
    createdUserIds.push(member.user.id);

    // Re-provisioning with the member's own code must not set referredById.
    const again = await provisionUser({
      googleId: `${RUN}_self`,
      name: "Self Referrer",
      email: `${RUN}.self@example.test`,
      referralCode: member.user.referralCode,
    });

    expect(again.referred).toBe(false);
    expect(again.user.referredById).toBeNull();
  });

  it("silently ignores an unknown referral code", async () => {
    const result = await provisionUser({
      googleId: `${RUN}_bad_code`,
      name: "Bad Code",
      email: `${RUN}.badcode@example.test`,
      referralCode: "CRC-DOESNOTEXIST",
    });
    createdUserIds.push(result.user.id);

    expect(result.referred).toBe(false);
    expect(result.user.referredById).toBeNull();
  });

  it("ignores a malformed referral code", async () => {
    const result = await provisionUser({
      googleId: `${RUN}_malformed`,
      name: "Malformed",
      email: `${RUN}.malformed@example.test`,
      referralCode: "!!not a code!!",
    });
    createdUserIds.push(result.user.id);

    expect(result.referred).toBe(false);
  });

  it("attributes a first-time member who previously signed in without a code", async () => {
    // Path A in provisionUser: the row exists but has no referrer yet.
    const referrer = await provisionUser({
      googleId: `${RUN}_late_owner`,
      name: "Late Owner",
      email: `${RUN}.lateowner@example.test`,
    });
    createdUserIds.push(referrer.user.id);

    const member = await provisionUser({
      googleId: `${RUN}_late_member`,
      name: "Late Member",
      email: `${RUN}.latemember@example.test`,
    });
    createdUserIds.push(member.user.id);
    expect(member.user.referredById).toBeNull();

    const second = await provisionUser({
      googleId: `${RUN}_late_member`,
      name: "Late Member",
      email: `${RUN}.latemember@example.test`,
      referralCode: referrer.user.referralCode,
    });

    expect(second.created).toBe(false);
    expect(second.referred).toBe(true);

    const reloaded = await prisma.user.findUnique({
      where: { id: member.user.id },
      select: { referredById: true },
    });
    expect(reloaded!.referredById).toBe(referrer.user.id);
  });
});

/* ==========================================================================
   CODE ALLOCATION + VALIDATION
   ========================================================================== */

describe.skipIf(!dbAvailable)("generateUniqueReferralCode", () => {
  it("never returns a code that is already in the database", async () => {
    const taken = await prisma.user.findFirst({
      select: { referralCode: true },
    });
    expect(taken).not.toBeNull();

    // Draw many codes; none may collide with an existing row.
    for (let i = 0; i < 25; i += 1) {
      const code = await generateUniqueReferralCode();
      const clash = await prisma.user.findUnique({ where: { referralCode: code } });
      expect(clash).toBeNull();
      expect(code).toMatch(/^CRC-[A-Z0-9]{8}$/);
    }
  });
});

describe.skipIf(!dbAvailable)("validateReferralCode", () => {
  it("resolves a real code and reports the referrer's name", async () => {
    const user = await provisionUser({
      googleId: `${RUN}_validate`,
      name: "Validate Me",
      email: `${RUN}.validate@example.test`,
    });
    createdUserIds.push(user.user.id);

    const result = await validateReferralCode(user.user.referralCode);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.code).toBe(user.user.referralCode);
      expect(result.referrerName).toBe("Validate Me");
    }
  });

  it("reports reason 'not_found' for a well-formed but unused code", async () => {
    const result = await validateReferralCode("CRC-ZZZZZZZZ");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

  it("reports reason 'malformed' for junk input", async () => {
    for (const junk of ["AB", "!!!", "", "   ", "A".repeat(40)]) {
      const result = await validateReferralCode(junk);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe("malformed");
    }
  });
});

/* ==========================================================================
   DASHBOARD OVERVIEW
   ========================================================================== */

describe.skipIf(!dbAvailable)("getUserOverview", () => {
  it("counts referrals and downloads in a single round of queries", async () => {
    const owner = await provisionUser({
      googleId: `${RUN}_ov_owner`,
      name: "Overview Owner",
      email: `${RUN}.ovowner@example.test`,
    });
    createdUserIds.push(owner.user.id);

    for (const n of [1, 2]) {
      const invitee = await provisionUser({
        googleId: `${RUN}_ov_inv${n}`,
        name: `Invitee ${n}`,
        email: `${RUN}.ovinv${n}@example.test`,
        referralCode: owner.user.referralCode,
      });
      createdUserIds.push(invitee.user.id);
    }

    await prisma.downloadLog.createMany({
      data: [
        { userId: owner.user.id, version: "1.0.0", platform: "android" },
        { userId: owner.user.id, version: "1.0.0", platform: "android" },
      ],
    });

    const overview = await getUserOverview(owner.user.id);
    expect(overview).not.toBeNull();
    expect(overview!.referralCount).toBe(2);
    expect(overview!.downloadCount).toBe(2);
    expect(overview!.referrals).toHaveLength(2);
    expect(overview!.lastDownloadAt).toBeInstanceOf(Date);
  });

  it("returns null for an id that does not exist", async () => {
    expect(await getUserOverview("no-such-id-xyz")).toBeNull();
  });

  it("reports zeroed counters for a brand-new member", async () => {
    const fresh = await provisionUser({
      googleId: `${RUN}_fresh`,
      name: "Fresh Member",
      email: `${RUN}.fresh@example.test`,
    });
    createdUserIds.push(fresh.user.id);

    const overview = await getUserOverview(fresh.user.id);
    expect(overview!.referralCount).toBe(0);
    expect(overview!.downloadCount).toBe(0);
    expect(overview!.lastDownloadAt).toBeNull();
  });
});

/* ==========================================================================
   SCHEMA INVARIANTS
   ========================================================================== */

describe.skipIf(!dbAvailable)("schema invariants", () => {
  it("enforces uniqueness on googleId, email and referralCode", async () => {
    const created = await provisionUser({
      googleId: `${RUN}_uniq`,
      name: "Unique Member",
      email: `${RUN}.uniq@example.test`,
    });
    createdUserIds.push(created.user.id);

    // Duplicate googleId
    await expect(
      prisma.user.create({
        data: {
          googleId: `${RUN}_uniq`,
          name: "Clone",
          email: `${RUN}.clone@example.test`,
          referralCode: `CRC-UNIQ${Date.now() % 10000}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Duplicate email
    await expect(
      prisma.user.create({
        data: {
          googleId: `${RUN}_uniq2`,
          name: "Clone",
          email: `${RUN}.uniq@example.test`,
          referralCode: `CRC-UNIQ${(Date.now() + 1) % 10000}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Duplicate referralCode
    await expect(
      prisma.user.create({
        data: {
          googleId: `${RUN}_uniq3`,
          name: "Clone",
          email: `${RUN}.uniq3@example.test`,
          referralCode: created.user.referralCode,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades download logs when a member is deleted", async () => {
    const member = await provisionUser({
      googleId: `${RUN}_cascade`,
      name: "Cascade Member",
      email: `${RUN}.cascade@example.test`,
    });

    await prisma.downloadLog.create({
      data: { userId: member.user.id, version: "1.0.0" },
    });
    expect(
      await prisma.downloadLog.count({ where: { userId: member.user.id } }),
    ).toBe(1);

    await prisma.user.delete({ where: { id: member.user.id } });
    expect(
      await prisma.downloadLog.count({ where: { userId: member.user.id } }),
    ).toBe(0);
  });

  it("detaches referrals (SET NULL) instead of deleting referred members", async () => {
    const referrer = await provisionUser({
      googleId: `${RUN}_detach`,
      name: "Detach Referrer",
      email: `${RUN}.detach@example.test`,
    });
    const invitee = await provisionUser({
      googleId: `${RUN}_detach_inv`,
      name: "Detach Invitee",
      email: `${RUN}.detachinv@example.test`,
      referralCode: referrer.user.referralCode,
    });
    createdUserIds.push(invitee.user.id);

    await prisma.user.delete({ where: { id: referrer.user.id } });

    const survivor = await prisma.user.findUnique({
      where: { id: invitee.user.id },
      select: { referredById: true, email: true },
    });
    expect(survivor).not.toBeNull();
    expect(survivor!.referredById).toBeNull();
  });
});

/* ==========================================================================
   NORMALISATION
   ========================================================================== */

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Aarav.Mehta@Example.COM ")).toBe(
      "aarav.mehta@example.com",
    );
  });
});
