/**
 * Creates the first Super Admin. Run it once per environment:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' ADMIN_NAME='Your Name' \
 *     npm run admin:create-super
 *
 * Values may also come from .env.local or .env. Variables already set in the
 * environment take precedence over those files.
 *
 * If any admin account already exists, nothing is changed and the script exits 0.
 * The password is never printed.
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) config({ path, override: false });
}

async function main(): Promise<number> {
  // Imported after the env files have loaded. The Prisma client reads DATABASE_URL on connect.
  const { bootstrapInputSchema, createFirstSuperAdmin } = await import(
    "../src/lib/admin-bootstrap"
  );
  const { prisma } = await import("../src/lib/prisma");

  try {
    const parsed = bootstrapInputSchema.safeParse({
      email: process.env.ADMIN_EMAIL ?? "",
      password: process.env.ADMIN_PASSWORD ?? "",
      name: process.env.ADMIN_NAME ?? "",
    });

    if (!parsed.success) {
      console.error("Cannot create the Super Admin:");
      // One message per field, so an empty value does not print two errors.
      const reported = new Set<string>();
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        if (reported.has(field)) continue;
        reported.add(field);
        console.error(`  - ${issue.message}`);
      }
      console.error(
        "Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME, then run the command again.",
      );
      return 1;
    }

    const result = await createFirstSuperAdmin(parsed.data);

    if (result.status === "created") {
      console.log(`Created Super Admin ${result.email} (id ${result.adminId}).`);
      console.log(
        "The password is stored as a bcrypt hash. Remove ADMIN_PASSWORD from your environment now.",
      );
    } else {
      console.log("An admin account already exists, so nothing was changed.");
    }
    return 0;
  } catch (error) {
    console.error(
      "Failed to create the Super Admin:",
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Unexpected failure:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
