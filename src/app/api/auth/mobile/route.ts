import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiSuccess,
  errorResponse,
  guardRoute,
  rateLimitedResponse,
  readJsonBody,
  validationErrorResponse,
} from "@/lib/http";
import { createRateLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/admin-session";
import { MobileAuthError, signInWithMobileCredential } from "@/lib/mobile-auth";
import { memberAuthConfigured } from "@/lib/member-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/auth/mobile
 * Body: { idToken, referralCode? }
 *
 * The native sign-in endpoint. It is the only way to obtain a member bearer
 * token, and it deliberately takes *only* a Google ID token: there is no
 * password path here, no email link, and no way to ask for a token for an id
 * somebody hands you. Everything this can do is bounded by what Google asserts.
 *
 * Rate limits, because this endpoint's job is to say "yes" to identity:
 * 8 exchanges per IP per 15 minutes is far above a real user's worst case
 * (install, sign in, reinstall) and below anything worth brute-forcing.
 */
const exchangeLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });

const bodySchema = z
  .object({
    /** Any one of these three. `pickCredential` decides, and says so in its error. */
    idToken: z.string().trim().min(16).max(8192).optional(),
    accessToken: z.string().trim().min(16).max(4096).optional(),
    code: z.string().trim().min(32).max(8192).optional(),
    /** The PKCE verifier that belongs to `code`. */
    verifier: z.string().trim().min(43).max(128).optional(),
    referralCode: z.string().trim().min(4).max(24).optional(),
  })
  // A stray `tokensToCredit` or `userId` in here must be a 400, not a surprise.
  .strict();

async function handlePOST(request: NextRequest) {
  const ip = getClientIp(request.headers) ?? "unknown";
  const throttle = exchangeLimiter.hit(ip);
  if (!throttle.allowed) {
    return rateLimitedResponse(
      "Too many sign-in attempts from this device. Try again shortly.",
      throttle.retryAfterSeconds,
    );
  }

  // Answering 503 while unconfigured is better than a 500 per attempt: the app
  // can show "sign-in is disabled on this build" instead of retrying forever.
  if (!memberAuthConfigured()) {
    return errorResponse(
      "AUTH_NOT_CONFIGURED",
      503,
      "Mobile sign-in is not configured on this server. Set MEMBER_TOKEN_SECRET (or NEXTAUTH_SECRET) and the Google client ids.",
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.flatten());
  }

  try {
    const result = await signInWithMobileCredential({
      idToken: parsed.data.idToken,
      accessToken: parsed.data.accessToken,
      code: parsed.data.code,
      verifier: parsed.data.verifier,
      referralCode: parsed.data.referralCode ?? null,
    });

    return apiSuccess(result, 200);
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return errorResponse(error.code, error.status, error.message);
    }
    throw error;
  }
}

// Each handler is wrapped: the domain errors above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/auth/mobile", handlePOST);
