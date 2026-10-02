import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Two project tiers:
 *
 *  • unit        — pure logic, no I/O. Runs anywhere, in milliseconds.
 *  • integration — talks to PostgreSQL and/or a running `next start`.
 *                  Skips itself automatically when the dependency is absent,
 *                  so `npm test` is always green on a clean checkout.
 *
 * The `@/*` alias mirrors `tsconfig.json`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },

  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Next.js loads .env for us; Vitest needs a nudge.
    setupFiles: ["./tests/setup.ts"],
    exclude: ["node_modules", ".next"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Keep memory modest for constrained containers (2 GB sandboxes).
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true, minForks: 1, maxForks: 1 },
    },
    reporters: ["verbose"],
  },
});
