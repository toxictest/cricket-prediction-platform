import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/user";
import { adminErrorResponse, adminJson } from "@/lib/admin-guard";
import {
  getUnknownUserHash,
  verifyAdminPassword,
} from "@/lib/admin-password";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieName,
  adminCookieOptions,
  createAdminSession,
  getAdminSessionSecret,
  getClientIp,
  signAdminToken,
} from "@/lib/admin-session";
import { createRateLimiter } from "@/lib/rate-limit";
import { guardRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Brute-force protection. Both limiters count an attempt before the password is
 * checked, so parallel guesses cannot all slip under the limit. The email
 * limiter protects one account. The IP limiter stops one client from trying
 * many accounts.
 */
const WINDOW_MS = 15 * 60 * 1000;
const emailLimiter = createRateLimiter({ limit: 10, windowMs: WINDOW_MS });
const ipLimiter = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(1).max(200),
});

/** One message for every credential failure, so the response does not reveal which part was wrong. */
function invalidCredentials(): ReturnType<typeof adminErrorResponse> {
  return adminErrorResponse("INVALID_CREDENTIALS", 401, "Invalid email or password.");
}

/**
 * POST /api/admin/login
 * Body: { email, password }. On success, sets the admin session cookie and
 * returns the admin's details and roles.
 */
async function handlePOST(request: NextRequest) {
  try {
    getAdminSessionSecret();
  } catch (error) {
    // Logged for the operator. The client gets a generic message, with no hint about the environment.
    console.error("[admin-login]", error instanceof Error ? error.message : error);
    return adminErrorResponse(
      "ADMIN_NOT_CONFIGURED",
      500,
      "Admin sign-in is not configured.",
    );
  }

  // A cross-site HTML form can send text/plain without a CORS preflight. Requiring
  // JSON closes that path to forced sign-in (login CSRF).
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return adminErrorResponse(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Send the request as application/json.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminErrorResponse("INVALID_JSON", 400, "Request body must be JSON.");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return adminErrorResponse(
      "VALIDATION_ERROR",
      400,
      parsed.error.issues[0]?.message ?? "Invalid input.",
      { details: parsed.error.flatten() },
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = getClientIp(request.headers);

  const throttle = [
    emailLimiter.hit(`email:${email}`),
    ipLimiter.hit(`ip:${ip ?? "unknown"}`),
  ].find((decision) => !decision.allowed);

  if (throttle && !throttle.allowed) {
    return adminErrorResponse(
      "RATE_LIMITED",
      429,
      "Too many sign-in attempts. Try again later.",
      { headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
    );
  }

  const admin = await prisma.adminUser.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      roles: true,
      isActive: true,
    },
  });

  // Always run one comparison. An unknown email then costs as much as a wrong password.
  const storedHash = admin?.passwordHash ?? (await getUnknownUserHash());
  const passwordMatches = await verifyAdminPassword(
    parsed.data.password,
    storedHash,
  );

  // Unknown email, wrong password and deactivated account all get the same answer.
  if (!admin || !admin.isActive || !passwordMatches) {
    return invalidCredentials();
  }

  const session = await createAdminSession({
    adminId: admin.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  const token = await signAdminToken({ adminId: admin.id, ...session });

  const { lastLoginAt } = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
    select: { lastLoginAt: true },
  });

  const response = adminJson(
    {
      ok: true,
      data: {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          roles: admin.roles,
          lastLoginAt,
        },
        session: { expiresAt: session.expiresAt },
      },
    },
    200,
  );

  response.cookies.set(
    adminCookieName(),
    token,
    adminCookieOptions(ADMIN_SESSION_TTL_SECONDS),
  );
  return response;
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const POST = guardRoute("api/admin/login", handlePOST);
