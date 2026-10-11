import { adminJson, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/me
 * Returns the signed-in admin with their roles. Any active admin may call it.
 */
export async function GET() {
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
