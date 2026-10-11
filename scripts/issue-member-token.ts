/**
 * Developer tool: mint a member bearer token for an account that already exists.
 *
 *   npm run mobile:token -- you@example.com
 *
 * Why this exists: the app's normal sign-in needs a browser handoff or a Google
 * client, and neither is worth fighting when you just want the wallet screen on a
 * device in front of you. The token it prints is the same 30-day credential
 * `POST /api/auth/mobile` issues, so every rule on the server still applies —
 * this only skips the Google part, which on a dev machine you have already done in
 * the web app.
 *
 * It reads DATABASE_URL and MEMBER_TOKEN_SECRET/NEXTAUTH_SECRET from .env.local,
 * like the other scripts. It never prints a password, and it refuses to run in
 * production: a tool that hands out member tokens on a live server is a hole, not
 * a convenience.
 */
import { prisma } from "../src/lib/prisma";
import { mintMemberToken, MEMBER_TOKEN_TTL_SECONDS } from "../src/lib/member-token";
import { normalizeEmail } from "../src/lib/user";

async function main(): Promise<number> {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to mint a token: NODE_ENV is production.");
    return 1;
  }

  const email = process.argv[2] ?? process.env.MOBILE_TOKEN_EMAIL ?? "";
  if (!email) {
    console.error("Usage: npm run mobile:token -- <member-email>");
    return 1;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      console.error(`No member with that email. Sign in on the web first: ${email}`);
      return 1;
    }

    const minted = await mintMemberToken({ userId: user.id, email: user.email });

    console.log(`Member:  ${user.email} (${user.id})`);
    console.log(`Valid:   ${Math.round(MEMBER_TOKEN_TTL_SECONDS / 86400)} days`);
    console.log(`Token:\n${minted.token}`);
    console.log("\nIn the app, choose “Paste sign-in token”. With curl:");
    console.log(`  curl -H "authorization: Bearer ${minted.token}" $API_URL/api/me`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().then((code) => process.exit(code));
