import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * NextAuth catch-all handler.
 *
 *   GET|POST /api/auth/signin/google
 *   GET      /api/auth/callback/google
 *   GET      /api/auth/session
 *   GET|POST /api/auth/signout
 *   GET      /api/auth/csrf
 *   GET      /api/auth/providers
 *
 * Must run on the Node.js runtime: the `signIn` callback writes to PostgreSQL
 * through Prisma, which cannot execute on the Edge runtime.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
