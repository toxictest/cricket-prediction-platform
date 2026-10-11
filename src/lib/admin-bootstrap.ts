import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/user";
import {
  checkAdminPasswordPolicy,
  hashAdminPassword,
} from "@/lib/admin-password";

/**
 * Creates the first Super Admin. Used only by scripts/create-super-admin.ts.
 *
 * There is deliberately no HTTP endpoint for this. An unauthenticated "create
 * the first admin" route would stay open for as long as the table is empty.
 */

export const bootstrapInputSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "ADMIN_EMAIL is required.")
    .max(254)
    .email("ADMIN_EMAIL must be a valid email address."),
  password: z.string().superRefine((value, ctx) => {
    const policy = checkAdminPasswordPolicy(value);
    if (!policy.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: policy.reason });
    }
  }),
  name: z
    .string()
    .trim()
    .min(1, "ADMIN_NAME is required.")
    .max(120, "ADMIN_NAME must be at most 120 characters."),
});

export type BootstrapInput = z.input<typeof bootstrapInputSchema>;

export type BootstrapResult =
  | { status: "created"; adminId: string; email: string }
  | { status: "skipped"; reason: "admin_exists" };

/**
 * Takes a lock that blocks other writers on `admin_users` until commit, so two
 * bootstrap runs started at the same moment cannot both see an empty table.
 * Plain reads are still allowed.
 */
const LOCK_ADMIN_TABLE = 'LOCK TABLE "admin_users" IN SHARE ROW EXCLUSIVE MODE';

export async function createFirstSuperAdmin(
  input: BootstrapInput,
): Promise<BootstrapResult> {
  // Throws a ZodError with a readable message on invalid input.
  const data = bootstrapInputSchema.parse(input);
  const email = normalizeEmail(data.email);

  // Hash before taking the lock, so the lock is held only for the cheap steps.
  const passwordHash = await hashAdminPassword(data.password);

  return prisma.$transaction<BootstrapResult>(async (tx) => {
    await tx.$executeRawUnsafe(LOCK_ADMIN_TABLE);

    if ((await tx.adminUser.count()) > 0) {
      return { status: "skipped", reason: "admin_exists" };
    }

    const admin = await tx.adminUser.create({
      data: {
        email,
        name: data.name,
        passwordHash,
        roles: ["SUPER_ADMIN"],
        isActive: true,
      },
      select: { id: true, email: true },
    });

    return { status: "created", adminId: admin.id, email: admin.email };
  });
}
