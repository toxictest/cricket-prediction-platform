import { getServerSession } from "next-auth";
import type { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/http";

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

   The id comes from the signed NextAuth JWT, never from the request body or
   query string, so a member cannot ask about somebody else's wallet or file a
   claim as somebody else.
   ========================================================================== */

export type MemberGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireMember(): Promise<MemberGuardResult> {
  const session = await getServerSession(authOptions);

  // `id` is an empty string when the JWT was issued before provisioning, and
  // absent for a session that predates a deleted account. Both are unauthenticated.
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: unauthorizedResponse() };

  return { ok: true, userId };
}
