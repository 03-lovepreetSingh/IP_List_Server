import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * In development, Next.js hot-reload re-imports modules on every request,
 * which would spawn a new PrismaClient (and a new connection pool) each
 * time — exhausting the DB. We stash the instance on `globalThis` so the
 * same client is reused across HMR cycles. In production there's no HMR,
 * so a plain `new PrismaClient()` is fine.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
