import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardRoute, apiSuccess, errorResponse } from "@/lib/http";
import { validateReferralCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERRAL_COOKIE = "cpc_ref";
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const bodySchema = z.object({
  code: z.string().trim().min(4).max(24),
});

/**
 * POST /api/referral/capture
 *
 * Persists a referral code into the httpOnly `cpc_ref` cookie so it survives
 * the full-page OAuth round-trip. `callbacks.signIn` reads and then clears it
 * while provisioning the account.
 *
 * The code is validated *before* being stored, so a garbage value can never
 * reach the database layer — and the cookie stays unset if it is invalid.
 */
async function handlePOST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", 400, "Malformed JSON body");
  }

  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", 400, "Referral codes are 4–24 characters.");
  }

  const result = await validateReferralCode(parsed.data.code);

  if (!result.valid) {
    return errorResponse(
      result.reason === "malformed" ? "VALIDATION_ERROR" : "NOT_FOUND",
      result.reason === "malformed" ? 400 : 404,
      result.reason === "malformed"
        ? "That referral code is not formatted correctly."
        : "No member is using that referral code.",
    );
  }

  const response = apiSuccess({
    code: result.code,
    referrerFirstName: result.referrerName.split(/\s+/)[0] ?? "A member",
  });

  response.cookies.set({
    name: REFERRAL_COOKIE,
    value: result.code,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
  });

  return response;
}

/** DELETE /api/referral/capture — lets the user un-apply a code. */
async function handleDELETE() {
  const response = apiSuccess({ cleared: true });
  response.cookies.set({
    name: REFERRAL_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/referral/capture", handlePOST);
export const DELETE = guardRoute("api/referral/capture", handleDELETE);
