-- P2 — Behavioral memory. See docs/AEGIS_P2_BEHAVIORAL_MEMORY.md.
-- Additive: new enums and tables (rollups, behavior state, versioned
-- baselines, deviations). No data backfill — rollups and baselines are
-- computed lazily from existing activity_events the first time each agent
-- is observed or viewed. New API keys get the `behavior:read` scope by
-- default; existing keys are NOT changed (see the P2 doc).

-- CreateEnum
CREATE TYPE "BaselineMaturity" AS ENUM ('NEW_AGENT', 'LIMITED_HISTORY', 'ESTABLISHED');

-- CreateEnum
CREATE TYPE "BehavioralDeviationKind" AS ENUM ('NEW_TOOL', 'NEW_DESTINATION', 'NEW_SERVICE', 'NEW_ACTION_TYPE', 'NEW_END_USER', 'UNUSUAL_DATA_TYPE', 'UNUSUAL_SEQUENCE', 'UNUSUAL_VOLUME', 'UNUSUAL_FREQUENCY', 'UNUSUAL_TIME');

-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET DEFAULT ARRAY['events:write', 'policy:evaluate', 'approvals:read', 'behavior:read']::TEXT[];

-- CreateTable
CREATE TABLE "agent_activity_rollups" (
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "recordSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "byteSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "agent_activity_rollups_pkey" PRIMARY KEY ("agentId","hourStart","dimension","key")
);

-- CreateTable
CREATE TABLE "agent_behavior_states" (
    "agentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rollupThrough" TIMESTAMP(3),
    "latestBaselineVersion" INTEGER NOT NULL DEFAULT 0,
    "lastRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_behavior_states_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "agent_baselines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "methodologyVersion" INTEGER NOT NULL,
    "maturity" "BaselineMaturity" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "eventsObserved" INTEGER NOT NULL,
    "activeDays" INTEGER NOT NULL,
    "activeHours" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioral_deviations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "BehavioralDeviationKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "baselineVersion" INTEGER NOT NULL,
    "maturity" "BaselineMaturity" NOT NULL,
    "confidence" "SecurityAlertConfidence" NOT NULL,
    "eventId" TEXT,
    "observed" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "behavioral_deviations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_activity_rollups_agentId_dimension_hourStart_idx" ON "agent_activity_rollups"("agentId", "dimension", "hourStart");

-- CreateIndex
CREATE INDEX "agent_behavior_states_organizationId_idx" ON "agent_behavior_states"("organizationId");

-- CreateIndex
CREATE INDEX "agent_baselines_organizationId_agentId_computedAt_idx" ON "agent_baselines"("organizationId", "agentId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_baselines_agentId_version_key" ON "agent_baselines"("agentId", "version");

-- CreateIndex
CREATE INDEX "behavioral_deviations_organizationId_agentId_firstSeenAt_idx" ON "behavioral_deviations"("organizationId", "agentId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "behavioral_deviations_agentId_kind_day_idx" ON "behavioral_deviations"("agentId", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "behavioral_deviations_agentId_kind_dedupeKey_day_key" ON "behavioral_deviations"("agentId", "kind", "dedupeKey", "day");

-- AddForeignKey
ALTER TABLE "agent_activity_rollups" ADD CONSTRAINT "agent_activity_rollups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_activity_rollups" ADD CONSTRAINT "agent_activity_rollups_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_behavior_states" ADD CONSTRAINT "agent_behavior_states_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_baselines" ADD CONSTRAINT "agent_baselines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_baselines" ADD CONSTRAINT "agent_baselines_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavioral_deviations" ADD CONSTRAINT "behavioral_deviations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavioral_deviations" ADD CONSTRAINT "behavioral_deviations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavioral_deviations" ADD CONSTRAINT "behavioral_deviations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "activity_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Append-only evidence (extends the P1 trigger function). A third, optional
-- argument lists "counter" columns that may change freely; everything else
-- follows the P1 rules (link-once column, nullable-on-delete columns).
-- Existing P1 triggers pass two arguments and behave exactly as before.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "aegis_enforce_append_only"() RETURNS trigger AS $$
DECLARE
  link_once_column text := NULLIF(TG_ARGV[0], '');
  nullable_columns text[] := COALESCE(TG_ARGV[1]::text[], ARRAY[]::text[]);
  counter_columns text[] := COALESCE(TG_ARGV[2]::text[], ARRAY[]::text[]);
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
BEGIN
  FOR col IN SELECT jsonb_object_keys(new_row) LOOP
    IF (old_row -> col) IS DISTINCT FROM (new_row -> col) THEN
      IF col = link_once_column AND (old_row ->> col) IS NULL THEN
        CONTINUE;
      END IF;
      IF col = ANY(nullable_columns) AND (new_row ->> col) IS NULL THEN
        CONTINUE;
      END IF;
      IF col = ANY(counter_columns) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'aegis: % rows are append-only security evidence; column "%" cannot be modified', TG_TABLE_NAME, col
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A baseline version is a historical record of what Aegis considered normal
-- at that time: never rewritten (new versions are appended).
CREATE TRIGGER "agent_baselines_append_only"
  BEFORE UPDATE ON "agent_baselines"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{}');

-- A deviation's description of what changed / why / what was expected is
-- immutable; only the repeat counters advance, and the event link may be
-- nulled if that event is deleted.
CREATE TRIGGER "behavioral_deviations_append_only"
  BEFORE UPDATE ON "behavioral_deviations"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{eventId}', '{occurrences,lastSeenAt}');
