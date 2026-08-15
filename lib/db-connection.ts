import type { PoolConfig } from "pg";

/**
 * Parses a `postgresql://` URL into discrete pg.PoolConfig fields instead
 * of passing `{ connectionString }` straight through.
 *
 * Why: passing `connectionString` directly to `new PrismaPg(...)` reliably
 * reproduces `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a
 * string` the moment Prisma's engine opens a second, transaction-dedicated
 * connection on a cold pool (e.g. the very first `upsert` in prisma/seed.ts)
 * — a race in how @prisma/adapter-pg 7.9.1 / pg 8.16.3 resolve the password
 * for that second connection. Discrete fields resolve the password
 * synchronously up front and side-step it entirely. Used by both lib/db.ts
 * (the app) and prisma/seed.ts (standalone script) so there's one place to
 * revisit this if a future adapter/pg release fixes the underlying bug.
 */
export function parseDatabaseUrl(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}
