import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { errorResponse, unauthorizedResponse } from "@/lib/http";
import { MemberTokenError, verifyMemberToken } from "@/lib/member-token";

/* ==========================================================================
   MEMBER GUARD
   ==========================================================================

   Mirror of `requireAdmin()` for the member side of the API.

     export async function GET() {
       const guard = await requireMember();
       if (!guard.ok) return guard.response;
       const { userId } = guard;
       // ...
     }

   Two credentials are accepted, and only these two:

   - `Authorization: Bearer <member token>` — what the native app sends. Minted
     by `POST /api/auth/mobile`, verified in `src/lib/member-token.ts`.
   - the NextAuth session cookie — what the web site has always sent, untouched.

   The id comes from the signed credential, never from the request body or query
   string, so a member cannot ask about somebody else's wallet or file a claim as
   somebody else.
   ========================================================================== */

export type MemberGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** `Bearer …`, case-insensitively, trimmed. Anything else is not a bearer attempt. */
function readBearer(header: string | null): string | null {
  const value = header?.trim() ?? "";
  if (!/^bearer\s+\S+/i.test(value)) return null;
  return value.slice(value.indexOf(" ") + 1).trim() || null;
}

/**
 * Reads the request headers. `next/headers` is request-scoped, and this module is
 * also imported by tooling that runs outside a request (scripts, the edge
 * middleware's type pass), where calling it throws — so a missing store means
 * "no bearer header", not "error".
 */
async function readBearerFromRequest(): Promise<string | null> {
  try {
    const store = await headers();
    return readBearer(store.get("authorization"));
  } catch {
    return null;
  }
}

export async function requireMember(): Promise<MemberGuardResult> {
  const bearer = await readBearerFromRequest();

  if (bearer) {
    try {
      const { userId } = await verifyMemberToken(bearer);
      return { ok: true, userId };
    } catch (error) {
      // An explicit bearer attempt is answered on its own terms. Falling through
      // to the cookie here would let a client with both credentials silently act
      // as whichever identity happened to be cached, which is a bug nobody sees
      // until a wallet is credited to the wrong person.
      if (error instanceof MemberTokenError) {
        if (error.code === "AUTH_NOT_CONFIGURED") {
          return {
            ok: false,
            response: errorResponse("AUTH_NOT_CONFIGURED", 503, error.message),
          };
        }
        return { ok: false, response: errorResponse("UNAUTHORIZED", 401, error.message) };
      }
      throw error;
    }
  }

  const session = await getServerSession(authOptions);

  // `id` is an empty string when the JWT was issued before provisioning, and
  // absent for a session that predates a deleted account. Both are unauthenticated.
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: unauthorizedResponse() };

  return { ok: true, userId };
}
