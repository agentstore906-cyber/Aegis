import { Pool } from "pg";

// One-off, STRICTLY READ-ONLY diagnostic for the P3009 failure on
// 20260807175705_init_with_policy_engine.
//
// It runs only SELECTs. It never writes, never DDLs, never logs
// DATABASE_URL. Safe to run against production. Delete after use.
//
//   DATABASE_URL="<prod-neon-url>" npx tsx scripts/diagnose-init-migration.ts
//
// The output tells us, without guessing:
//   - the exact recorded state of every migration (finished_at / logs)
//   - which objects the init migration should have created already exist
//   - whether production actually holds Aegis data worth preserving

const EXPECTED_ENUMS = [
  "MemberRole",
  "AgentStatus",
  "RiskLevel",
  "Environment",
  "ActivityType",
  "ActivityStatus",
  "PolicyDecision",
  "PolicyStatus",
  "ConditionOperator",
];

const EXPECTED_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "organizations",
  "organization_members",
  "agents",
  "agent_tools",
  "activity_events",
  "agent_permissions",
  "policies",
  "policy_conditions",
  "policy_evaluations",
];

const EXPECTED_INDEXES = [
  "users_email_key",
  "accounts_userId_idx",
  "accounts_provider_providerAccountId_key",
  "sessions_sessionToken_key",
  "sessions_userId_idx",
  "verification_tokens_token_key",
  "verification_tokens_identifier_token_key",
  "organizations_slug_key",
  "organization_members_userId_idx",
  "organization_members_organizationId_userId_key",
  "agents_organizationId_status_idx",
  "agents_organizationId_slug_key",
  "agent_tools_agentId_name_key",
  "activity_events_organizationId_timestamp_idx",
  "activity_events_agentId_timestamp_idx",
  "activity_events_organizationId_status_idx",
  "activity_events_organizationId_riskLevel_idx",
  "activity_events_traceId_idx",
  "agent_permissions_organizationId_agentId_idx",
  "agent_permissions_agentId_action_resource_key",
  "policies_organizationId_status_idx",
  "policies_organizationId_agentId_idx",
  "policy_conditions_policyId_idx",
  "policy_evaluations_activityEventId_key",
  "policy_evaluations_organizationId_createdAt_idx",
  "policy_evaluations_agentId_createdAt_idx",
  "policy_evaluations_organizationId_decision_idx",
  "policy_evaluations_traceId_idx",
];

const EXPECTED_FKS = [
  "accounts_userId_fkey",
  "sessions_userId_fkey",
  "organization_members_organizationId_fkey",
  "organization_members_userId_fkey",
  "agents_organizationId_fkey",
  "agent_tools_agentId_fkey",
  "activity_events_organizationId_fkey",
  "activity_events_agentId_fkey",
  "agent_permissions_organizationId_fkey",
  "agent_permissions_agentId_fkey",
  "policies_organizationId_fkey",
  "policies_agentId_fkey",
  "policies_createdById_fkey",
  "policy_conditions_policyId_fkey",
  "policy_evaluations_organizationId_fkey",
  "policy_evaluations_agentId_fkey",
  "policy_evaluations_activityEventId_fkey",
];

function diff(expected: string[], actual: Set<string>) {
  const present = expected.filter((e) => actual.has(e));
  const missing = expected.filter((e) => !actual.has(e));
  return { present, missing };
}

// `array_agg(...)` over a `name` column comes back as a real JS array only
// when node-pg has a parser registered for that array's element type. To be
// robust regardless of driver/version, the query casts labels to text, and
// this still tolerates the raw Postgres array literal (`{A,B,C}`) just in
// case the value arrives as a string.
function toLabelArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return String(value)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((s) => s.replace(/^"|"$/g, "").trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // --- 1. Migration ledger --------------------------------------------------
  const ledgerExists = await pool.query(
    `SELECT to_regclass('public._prisma_migrations') AS t`
  );
  console.log("=== _prisma_migrations present:", !!ledgerExists.rows[0]?.t, "===\n");

  if (ledgerExists.rows[0]?.t) {
    const rows = await pool.query(
      `SELECT migration_name, started_at, finished_at, rolled_back_at,
              applied_steps_count, logs
         FROM public._prisma_migrations
         ORDER BY started_at`
    );
    for (const r of rows.rows) {
      const state = r.rolled_back_at
        ? "ROLLED BACK"
        : r.finished_at
        ? "applied"
        : "!!! FAILED / UNFINISHED !!!";
      console.log(`- ${r.migration_name}`);
      console.log(`    state:               ${state}`);
      console.log(`    started_at:          ${r.started_at?.toISOString?.() ?? r.started_at}`);
      console.log(`    finished_at:         ${r.finished_at?.toISOString?.() ?? r.finished_at}`);
      console.log(`    rolled_back_at:      ${r.rolled_back_at?.toISOString?.() ?? r.rolled_back_at}`);
      console.log(`    applied_steps_count: ${r.applied_steps_count}`);
      if (r.logs) console.log(`    logs: ${String(r.logs).replace(/\n/g, "\n          ")}`);
      console.log();
    }
  }

  // --- 2. Enum types -------------------------------------------------------
  const enums = await pool.query(
    `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace
      GROUP BY t.typname
      ORDER BY t.typname`
  );
  const enumSet = new Set<string>(enums.rows.map((r) => r.typname));
  const enumDiff = diff(EXPECTED_ENUMS, enumSet);
  console.log("=== ENUM TYPES (from init migration) ===");
  console.log("  present:", enumDiff.present.join(", ") || "(none)");
  console.log("  MISSING:", enumDiff.missing.join(", ") || "(none)");
  for (const r of enums.rows) {
    if (EXPECTED_ENUMS.includes(r.typname))
      console.log(`    ${r.typname}: [${toLabelArray(r.labels).join(", ")}]`);
  }
  console.log();

  // --- 3. Tables ---------------------------------------------------------
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  const tableSet = new Set<string>(tables.rows.map((r) => r.table_name));
  const tableDiff = diff(EXPECTED_TABLES, tableSet);
  console.log("=== TABLES (from init migration) ===");
  console.log("  present:", tableDiff.present.join(", ") || "(none)");
  console.log("  MISSING:", tableDiff.missing.join(", ") || "(none)");
  console.log("  all public tables:", [...tableSet].sort().join(", "));
  console.log();

  // --- 4. Indexes ------------------------------------------------------
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
  );
  const idxSet = new Set<string>(idx.rows.map((r) => r.indexname));
  const idxDiff = diff(EXPECTED_INDEXES, idxSet);
  console.log("=== INDEXES (from init migration) ===");
  console.log("  present count:", idxDiff.present.length, "/", EXPECTED_INDEXES.length);
  console.log("  MISSING:", idxDiff.missing.join(", ") || "(none)");
  console.log();

  // --- 5. Foreign keys ----------------------------------------------
  const fks = await pool.query(
    `SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace`
  );
  const fkSet = new Set<string>(fks.rows.map((r) => r.conname));
  const fkDiff = diff(EXPECTED_FKS, fkSet);
  console.log("=== FOREIGN KEYS (from init migration) ===");
  console.log("  present count:", fkDiff.present.length, "/", EXPECTED_FKS.length);
  console.log("  MISSING:", fkDiff.missing.join(", ") || "(none)");
  console.log();

  // --- 6. Data present? --------------------------------------------
  console.log("=== ROW COUNTS (is there real Aegis data to preserve?) ===");
  for (const t of ["users", "organizations", "agents", "activity_events", "policies", "audit_events"]) {
    if (tableSet.has(t)) {
      try {
        const c = await pool.query(`SELECT count(*)::int AS n FROM "${t}"`);
        console.log(`  ${t}: ${c.rows[0].n}`);
      } catch (e) {
        console.log(`  ${t}: <error ${(e as Error).message}>`);
      }
    } else {
      console.log(`  ${t}: <table does not exist>`);
    }
  }
  console.log();

  // --- 7. Verdict ------------------------------------------------
  const initFullyPresent =
    enumDiff.missing.length === 0 &&
    tableDiff.missing.length === 0 &&
    idxDiff.missing.length === 0 &&
    fkDiff.missing.length === 0;
  console.log("=== INIT MIGRATION SCHEMA COMPLETE (all enums+tables+indexes+FKs present)? ===");
  console.log(" ", initFullyPresent ? "YES" : "NO — partially applied, see MISSING lists above");

  await pool.end();
}

main().catch((err) => {
  console.error("DIAGNOSE_FAILED", err);
  process.exit(1);
});
