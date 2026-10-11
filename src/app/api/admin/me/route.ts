import { adminJson, requireAdmin } from "@/lib/admin-guard";
import { guardRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/me
 * Returns the signed-in admin with their roles. Any active admin may call it.
 */
async function handleGET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { admin } = guard;

  return adminJson(
    {
      ok: true,
      data: {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          roles: admin.roles,
          lastLoginAt: admin.lastLoginAt,
        },
        session: { expiresAt: admin.sessionExpiresAt },
      },
    },
    200,
  );
}

// Each handler is wrapped: the domain mappers above own the expected failures, and
// `guardRoute` catches anything else so the answer is still the JSON envelope.
// Asserted for every route by tests/api-envelope.test.ts.
export const GET = guardRoute("api/admin/me", handleGET);
