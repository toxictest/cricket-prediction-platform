import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { SignJWT } from "jose";
import {
  MEMBER_TOKEN_TTL_SECONDS,
  MemberTokenError,
  getMemberTokenSecret,
  memberAuthConfigured,
  mintMemberToken,
  verifyMemberToken,
} from "@/lib/member-token";
import { allowedGoogleAudiences, signInWithGoogleIdToken, MobileAuthError } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

/* ==========================================================================
   THE BEARER CREDENTIAL THE NATIVE APP CARRIES
   ==========================================================================

   Three things have to be true and none of them is obvious from the code:
   the token must not be forgeable, it must not be replayable as an admin
   session, and a server that cannot mint one must say so instead of half-working.
   ========================================================================== */

const SECRET = "test-member-token-secret-0123456789abcdef";
const savedSecret = process.env.MEMBER_TOKEN_SECRET;
const savedNextAuth = process.env.NEXTAUTH_SECRET;

beforeAll(() => {
  process.env.MEMBER_TOKEN_SECRET = SECRET;
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.MEMBER_TOKEN_SECRET;
  else process.env.MEMBER_TOKEN_SECRET = savedSecret;
  if (savedNextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = savedNextAuth;
});

describe("the signing key", () => {
  it("refuses a missing, short or placeholder secret", () => {
    process.env.MEMBER_TOKEN_SECRET = "";
    delete process.env.NEXTAUTH_SECRET;
    expect(() => getMemberTokenSecret()).toThrow(MemberTokenError);
    expect(memberAuthConfigured()).toBe(false);

    process.env.MEMBER_TOKEN_SECRET = "replace-me-with-openssl-rand-base64-48";
    expect(memberAuthConfigured()).toBe(false);

    process.env.MEMBER_TOKEN_SECRET = "short";
    expect(memberAuthConfigured()).toBe(false);

    process.env.MEMBER_TOKEN_SECRET = SECRET;
    expect(memberAuthConfigured()).toBe(true);
  });

  it("falls back to NEXTAUTH_SECRET, which already guards the same identity", () => {
    delete process.env.MEMBER_TOKEN_SECRET;
    process.env.NEXTAUTH_SECRET = "nextauth-secret-value-that-is-long-enough-32";
    expect(memberAuthConfigured()).toBe(true);
    process.env.MEMBER_TOKEN_SECRET = SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });
});

describe("mint and verify", () => {
  it("round-trips the member id and nothing else", async () => {
    const minted = await mintMemberToken({ userId: "user-123", email: "a@b.test" });
    expect(minted.expiresInSeconds).toBe(MEMBER_TOKEN_TTL_SECONDS);

    const claims = await verifyMemberToken(minted.token);
    expect(claims).toEqual({ userId: "user-123", email: "a@b.test" });
  });

  it("rejects a tampered payload", async () => {
    const minted = await mintMemberToken({ userId: "user-123" });
    const [, payload, signature] = minted.token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), uid: "victim" }),
    ).toString("base64url");

    await expect(verifyMemberToken(`${minted.token.split(".")[0]}.${forged}.${signature}`)).rejects.toThrow(
      MemberTokenError,
    );
  });

  it("rejects an expired token with a message the app can show", async () => {
    const key = new TextEncoder().encode(SECRET);
    const stale = await new SignJWT({ typ: "member-access", uid: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("cpc-member")
      .setAudience("cpc-member")
      .setIssuedAt(Math.floor(Date.now() / 1000) - MEMBER_TOKEN_TTL_SECONDS - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);

    const error = await verifyMemberToken(stale).catch((e) => e);
    expect(error).toBeInstanceOf(MemberTokenError);
    expect((error as MemberTokenError).code).toBe("TOKEN_EXPIRED");
    expect((error as MemberTokenError).message).toMatch(/expired/i);
  });

  it("will not accept a correctly signed token that is not a member token", async () => {
    // Same algorithm, same key material available to an attacker who read the
    // example env file: the `typ` claim is what stops it being enough.
    const key = new TextEncoder().encode(SECRET);
    const lookalike = await new SignJWT({ uid: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("cpc-member")
      .setAudience("cpc-member")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifyMemberToken(lookalike)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("will not accept a token minted for another issuer or audience", async () => {
    const key = new TextEncoder().encode(SECRET);
    const foreign = await new SignJWT({ typ: "member-access", uid: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("someone-else")
      .setAudience("someone-else")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifyMemberToken(foreign)).rejects.toThrow(MemberTokenError);
  });
});

describe("which Google client ids are trusted", () => {
  it("accepts the web id and the native id, and no placeholder", () => {
    const savedWeb = process.env.GOOGLE_CLIENT_ID;
    const savedMobile = process.env.GOOGLE_MOBILE_CLIENT_ID;
    try {
      process.env.GOOGLE_CLIENT_ID = "web-id.apps.googleusercontent.com";
      process.env.GOOGLE_MOBILE_CLIENT_ID = "android-id.apps.googleusercontent.com";
      expect(allowedGoogleAudiences().sort()).toEqual([
        "android-id.apps.googleusercontent.com",
        "web-id.apps.googleusercontent.com",
      ]);

      process.env.GOOGLE_MOBILE_CLIENT_ID = "";
      expect(allowedGoogleAudiences()).toEqual(["web-id.apps.googleusercontent.com"]);

      process.env.GOOGLE_CLIENT_ID = "replace-me";
      expect(allowedGoogleAudiences()).toEqual([]);
    } finally {
      if (savedWeb === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = savedWeb;
      if (savedMobile === undefined) delete process.env.GOOGLE_MOBILE_CLIENT_ID;
      else process.env.GOOGLE_MOBILE_CLIENT_ID = savedMobile;
    }
  });
});

describe("the member guard takes the bearer first", () => {
  it("checks the header before the cookie and never mixes the two", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "member-auth.ts"), "utf8");
    const bearerBranch = source.indexOf("if (bearer)");
    const cookieBranch = source.indexOf("getServerSession(authOptions)");
    expect(bearerBranch).toBeGreaterThan(-1);
    expect(cookieBranch).toBeGreaterThan(bearerBranch);
    // An invalid bearer must produce a response, not fall through to the cookie.
    expect(source.slice(bearerBranch, cookieBranch)).toMatch(/return \{ ok: false/);
    expect(source.slice(bearerBranch, cookieBranch)).toMatch(/throw error/);
  });
});

/* ==========================================================================
   THE EXCHANGE, ON A REAL DATABASE
   ========================================================================== */

const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping the mobile sign-in exchange tests.\n");
    return false;
  });

const run = `mob-${Date.now()}`;
const createdUserIds: string[] = [];

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("signing in on a phone", () => {
  it("provisions the member, their wallet, and a token that resolves to them", async () => {
    const googleId = `${run}-${randomUUID().slice(0, 8)}`;
    const email = `${run}@example.test`;
    // The stub stands in for Google's signature check; everything after it is the
    // production code path, including provisionUser and the wallet creation.
    const verify = async () => ({
      googleId,
      email,
      name: "Phone Member",
      image: "https://example.test/avatar.png",
    });

    const first = await signInWithGoogleIdToken({ idToken: "opaque-google-token" }, { verify });
    expect(first.created).toBe(true);
    expect(first.user.email).toBe(email);
    createdUserIds.push(first.user.id);

    const claims = await verifyMemberToken(first.token);
    expect(claims.userId).toBe(first.user.id);

    const wallet = await prisma.wallet.findUnique({ where: { userId: first.user.id } });
    expect(wallet).toMatchObject({ depositBalance: 0, winningBalance: 0 });

    // Signing in again is not a second registration.
    const again = await signInWithGoogleIdToken({ idToken: "opaque-google-token" }, { verify });
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("refuses an account Google says is not verified, before touching the database", async () => {
    const verify = async () => {
      throw new MobileAuthError(
        "FORBIDDEN",
        "Google says this email address is not verified. Verify it with Google, then sign in again.",
        403,
      );
    };
    const before = await prisma.user.count();
    const error = await signInWithGoogleIdToken({ idToken: "x" }, { verify }).catch((e) => e);
    expect(error).toBeInstanceOf(MobileAuthError);
    expect((error as MobileAuthError).code).toBe("FORBIDDEN");
    expect(await prisma.user.count()).toBe(before);
  });
});
