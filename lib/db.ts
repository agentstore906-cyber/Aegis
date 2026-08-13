import { Prisma, PrismaClient } from "@prisma/client";
import "@/lib/env";

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

/**
 * Either the module-level Prisma client or an interactive transaction
 * handle. Repository write functions that accept this (instead of always
 * using the module `prisma` client directly) can be composed inside a
 * caller's `$transaction` — e.g. so a mutation and its audit event commit
 * atomically — while still defaulting to a plain top-level write when
 * called standalone.
 */
export type PrismaOrTx = typeof prisma | Prisma.TransactionClient;
