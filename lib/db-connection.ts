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
 *
 * Splitting the URL into fields also drops its query string, so the TLS
 * intent (`?sslmode=require`) has to be re-applied here explicitly — see
 * `sslFromUrl`. Without it the pool connects in plaintext: fine for a local
 * Postgres, but managed providers reject it, and Neon in particular routes
 * by the TLS SNI host, so a plaintext connection fails authentication
 * outright ("User was denied access on the database") even with correct
 * credentials. The Prisma CLI is unaffected because it consumes the full
 * connection string (prisma.config.ts), query params included.
 */
export function parseDatabaseUrl(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const config: PoolConfig = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };

  const ssl = sslFromUrl(url);
  if (ssl !== undefined) config.ssl = ssl;

  return config;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Mirrors libpq `sslmode` semantics onto pg's `ssl` option:
 *   - `disable`                     -> no TLS
 *   - `verify-ca` / `verify-full`   -> TLS with CA verification
 *   - `require` / `prefer` / unset  -> TLS without CA verification
 * A remote host with no `sslmode` still gets TLS (managed Postgres needs
 * it); a local host with no `sslmode` stays plaintext (matches dev setup).
 */
function sslFromUrl(url: URL): PoolConfig["ssl"] {
  const sslmode = url.searchParams.get("sslmode");

  if (sslmode === "disable") return undefined;
  if (sslmode === "verify-ca" || sslmode === "verify-full") {
    return { rejectUnauthorized: true };
  }
  if (sslmode) return { rejectUnauthorized: false };

  return LOCAL_HOSTS.has(url.hostname) ? undefined : { rejectUnauthorized: false };
}
