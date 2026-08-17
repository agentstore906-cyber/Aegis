import { Pool } from "pg";

// One-off, read-only diagnostic: lists what already exists in the `public`
// schema so a blocked `prisma migrate deploy` (P3018) can be resolved
// precisely instead of guessed at. Never logs DATABASE_URL. Safe to delete
// after use — not part of the app's runtime.
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  const enums = await pool.query(
    `SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e' ORDER BY typname`
  );
  const migrationsTable = await pool.query(
    `SELECT to_regclass('public._prisma_migrations') AS exists`
  );
  let migrationRows: unknown[] = [];
  if (migrationsTable.rows[0]?.exists) {
    const res = await pool.query(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM public._prisma_migrations ORDER BY started_at`
    );
    migrationRows = res.rows;
  }

  console.log("=== TABLES ===");
  console.log(tables.rows.map((r) => r.table_name).join("\n") || "(none)");
  console.log("=== ENUM TYPES ===");
  console.log(enums.rows.map((r) => r.typname).join("\n") || "(none)");
  console.log("=== _prisma_migrations TABLE PRESENT ===");
  console.log(!!migrationsTable.rows[0]?.exists);
  console.log("=== _prisma_migrations ROWS ===");
  console.log(JSON.stringify(migrationRows, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error("INTROSPECT_FAILED", err);
  process.exit(1);
});
