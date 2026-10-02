import { PrismaClient } from "@prisma/client";

/**
 * Next.js dev-mode hot reload re-evaluates modules on every request, which
 * would otherwise open a brand-new connection pool each time and exhaust
 * PostgreSQL's `max_connections`. Cache the client on `globalThis`.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    errorFormat: process.env.NODE_ENV === "development" ? "pretty" : "minimal",
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Graceful shutdown for scripts (seeders, workers) running outside Next.js. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
