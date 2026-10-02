import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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
export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON body", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Referral codes are 4–24 characters.",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const result = await validateReferralCode(parsed.data.code);

  if (!result.valid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.reason === "malformed"
            ? "That referral code is not formatted correctly."
            : "No member is using that referral code.",
        code: result.reason === "malformed" ? "VALIDATION_ERROR" : "NOT_FOUND",
      },
      { status: result.reason === "malformed" ? 400 : 404 },
    );
  }

  const response = NextResponse.json(
    {
      ok: true,
      data: {
        code: result.code,
        referrerFirstName: result.referrerName.split(/\s+/)[0] ?? "A member",
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );

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
export async function DELETE() {
  const response = NextResponse.json(
    { ok: true, data: { cleared: true } },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
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
