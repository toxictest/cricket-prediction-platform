import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Test environment bootstrap.
 *
 * Next.js loads `.env` automatically; Vitest does not. Without this, every
 * Prisma-backed test would fail to resolve `DATABASE_URL` and silently skip.
 *
 * Load order mirrors what a developer would expect, with the first file found
 * winning for any given key:
 *
 *   1. .env.local   — personal overrides, git-ignored
 *   2. .env.test    — dedicated test database, optional
 *   3. .env         — the shared development file
 *
 * `override: false` means a variable already present in the real environment
 * (e.g. injected by CI) always wins over the files.
 */

const root = resolve(__dirname, "..");

for (const file of [".env.local", ".env.test", ".env"]) {
  const path = resolve(root, file);
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

// ---- sanity checks ---------------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.warn(
    "\n  ⚠ DATABASE_URL is not set — Prisma-backed tests will skip." +
      "\n    Fix with: npm run db:setup\n",
  );
}

// A missing secret would make NextAuth throw inside the route handlers and
// produce confusing failures in the HTTP contract tests.
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = "test-only-secret-not-used-in-production";
}

if (!process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

// Admin sessions refuse to sign tokens without a real secret (see admin-session.ts),
// and they reject the "replace-me..." placeholder that setup-dev-db.sh writes into a
// fresh .env. Tests get an obviously fake value either way, so they never depend on
// a developer's .env and never sign a token with a placeholder key.
const placeholder = process.env.ADMIN_SESSION_SECRET ?? "";
if (placeholder.length === 0 || placeholder.startsWith("replace-me")) {
  process.env.ADMIN_SESSION_SECRET = "test-only-admin-session-secret-0123456789";
}

// Money endpoints are gated on MONEY_MODE and switch themselves off under
// NODE_ENV=production. A test run always exercises the code, so the gate is
// opened here; the flag's own behaviour is covered in tests/payment-http.test.ts.
if (!process.env.MONEY_MODE) {
  process.env.MONEY_MODE = "true";
}
