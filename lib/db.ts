import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { parseDatabaseUrl } from "@/lib/db-connection";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7 requires a driver adapter for a direct database connection —
// there's no more `datasource.url` in schema.prisma (see prisma.config.ts
// for the CLI-side equivalent, used only by migrate/generate/studio).
// Discrete fields, not `{ connectionString: env.DATABASE_URL }` — see
// lib/db-connection.ts for why.
const adapter = new PrismaPg(parseDatabaseUrl(env.DATABASE_URL));

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
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
