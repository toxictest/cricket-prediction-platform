import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createFirstSuperAdmin } from "@/lib/admin-bootstrap";
import { verifyAdminPassword } from "@/lib/admin-password";

/**
 * Bootstrap tests for the first Super Admin.
 *
 * The "creates the first admin" case needs an empty admin_users table. It runs
 * only against a disposable database, meaning one whose name contains "test"
 * (for example cricket_platform_test). Against any other database that case is
 * skipped, and nothing is deleted.
 */

const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping bootstrap tests.\n");
    return false;
  });

function databaseIsDisposable(): boolean {
  try {
    return /test/i.test(new URL(process.env.DATABASE_URL ?? "").pathname);
  } catch {
    return false;
  }
}

const disposable = dbAvailable && databaseIsDisposable();
const PASSWORD = "a long enough bootstrap passphrase";
const createdEmails: string[] = [];

afterAll(async () => {
  if (dbAvailable) {
    if (createdEmails.length > 0) {
      await prisma.adminUser.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await prisma.$disconnect();
  }
});

describe.skipIf(!dbAvailable)("createFirstSuperAdmin", () => {
  it("does nothing when an admin already exists", async () => {
    const email = `existing-${randomUUID().slice(0, 8)}@example.test`;
    createdEmails.push(email);
    await prisma.adminUser.create({
      data: { email, passwordHash: "not-used", name: "Existing", roles: ["PAYMENT_ADMIN"] },
    });
    const before = await prisma.adminUser.count();

    const result = await createFirstSuperAdmin({
      email: `second-${randomUUID().slice(0, 8)}@example.test`,
      password: PASSWORD,
      name: "Second",
    });

    expect(result).toEqual({ status: "skipped", reason: "admin_exists" });
    expect(await prisma.adminUser.count()).toBe(before);
  });

  it("rejects a weak password or a malformed email without writing anything", async () => {
    const before = await prisma.adminUser.count();

    await expect(
      createFirstSuperAdmin({ email: "ok@example.test", password: "short", name: "X" }),
    ).rejects.toThrow(/at least 12 characters/);

    await expect(
      createFirstSuperAdmin({ email: "not-an-email", password: PASSWORD, name: "X" }),
    ).rejects.toThrow(/valid email/);

    expect(await prisma.adminUser.count()).toBe(before);
  });

  it.skipIf(!disposable)(
    "creates one SUPER_ADMIN when the table is empty, then refuses to run again",
    async () => {
      // Safe only because the database name contains "test" (checked above).
      await prisma.adminUser.deleteMany({});
      createdEmails.push("root@example.test");

      const first = await createFirstSuperAdmin({
        email: "Root@Example.test",
        password: PASSWORD,
        name: "  Root Admin  ",
      });
      expect(first.status).toBe("created");

      const row = await prisma.adminUser.findUniqueOrThrow({
        where: { email: "root@example.test" },
      });
      expect(row.roles).toEqual(["SUPER_ADMIN"]);
      expect(row.name).toBe("Root Admin");
      expect(row.isActive).toBe(true);
      expect(row.passwordHash).not.toContain(PASSWORD);
      expect(await verifyAdminPassword(PASSWORD, row.passwordHash)).toBe(true);

      const second = await createFirstSuperAdmin({
        email: "other@example.test",
        password: PASSWORD,
        name: "Other",
      });
      expect(second).toEqual({ status: "skipped", reason: "admin_exists" });
      expect(await prisma.adminUser.count()).toBe(1);
    },
    60_000,
  );
});
