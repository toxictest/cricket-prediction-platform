import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { HANDOFF_TTL_SECONDS, mintHandoffCode } from "@/lib/mobile-handoff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /mobile/start?challenge=<s256>&redirect=<none|url>
 *
 * The browser half of mobile sign-in. The app opens the system browser here after
 * generating a PKCE verifier; this page turns the member's existing web session
 * into a one-shot code bound to that challenge, and sends the browser back to the
 * app's custom scheme.
 *
 * It is a page route, not an API route, because it is the one place in the product
 * that answers with a redirect into another application. It is also the only place
 * that hands out a member token without Google being consulted — which is safe for
 * exactly one reason: the identity it copies came from NextAuth's own Google
 * callback in this same browser.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    // Send the member to sign-in and bring them back here with the challenge intact.
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login, 302);
  }

  const challenge = request.nextUrl.searchParams.get("challenge")?.trim() ?? "";
  if (challenge.length < 43 || challenge.length > 128) {
    return new NextResponse(
      "This sign-in request is missing its security challenge. Close the app's browser window and try again.",
      { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return new NextResponse("This account no longer exists.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const handed = await mintHandoffCode({ userId: user.id, email: user.email, challenge });

  // `redirect=none` stops here and prints the code. That is a developer escape
  // hatch for running the app inside Expo Go, where the custom scheme is not
  // registered — never the production path, and nothing secret is shown that the
  // device did not just ask for.
  if (request.nextUrl.searchParams.get("redirect") === "none") {
    const html = `<!doctype html><meta charset="utf-8"><title>Sign in to the app</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,monospace;background:#05070d;color:#e6edf7;padding:24px;max-width:760px;margin:0 auto}
code{display:block;white-space:pre-wrap;word-break:break-all;background:#0b1220;border:1px solid #1e2b45;padding:12px;border-radius:8px}
p{color:#8b9ab4}</style>
<h1>Sign-in code</h1>
<p>Copy this into the app. It expires in ${HANDOFF_TTL_SECONDS} seconds and works only with the verifier this browser session was started with.</p>
<code>${handed.code.replace(/[<>&]/g, "")}</code>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return NextResponse.redirect(handed.redirectUri, 302);
}
