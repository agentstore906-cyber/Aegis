-- P1 — Agent data foundation. See docs/AEGIS_P1_DATA_FOUNDATION.md.
-- Additive: new enums, nullable/defaulted columns, indexes, two foreign
-- keys; conservative backfills; append-only triggers on security evidence.

-- CreateEnum
CREATE TYPE "EventOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'BLOCKED', 'WARNING');

-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PII', 'FINANCIAL', 'HEALTH', 'CREDENTIALS');

-- CreateEnum
CREATE TYPE "DestinationKind" AS ENUM ('HOST', 'IP', 'EMAIL_DOMAIN');

-- AlterTable
ALTER TABLE "activity_events" ADD COLUMN     "byteCount" INTEGER,
ADD COLUMN     "clientEventId" TEXT,
ADD COLUMN     "dataClasses" "DataClass"[] DEFAULT ARRAY[]::"DataClass"[],
ADD COLUMN     "dataSensitivity" "RiskLevel",
ADD COLUMN     "destination" TEXT,
ADD COLUMN     "destinationKind" "DestinationKind",
ADD COLUMN     "endUserHash" TEXT,
ADD COLUMN     "environment" "Environment",
ADD COLUMN     "evaluationId" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMP(3),
ADD COLUMN     "outcome" "EventOutcome",
ADD COLUMN     "parentClientEventId" TEXT,
ADD COLUMN     "recordCount" INTEGER,
ADD COLUMN     "riskSignals" JSONB,
ADD COLUMN     "service" TEXT,
ADD COLUMN     "toolKey" TEXT;

-- CreateIndex
CREATE INDEX "activity_events_parentEventId_idx" ON "activity_events"("parentEventId");

-- CreateIndex
CREATE INDEX "activity_events_agentId_parentClientEventId_idx" ON "activity_events"("agentId", "parentClientEventId");

-- CreateIndex
CREATE INDEX "activity_events_evaluationId_idx" ON "activity_events"("evaluationId");

-- CreateIndex
CREATE INDEX "activity_events_agentId_toolKey_idx" ON "activity_events"("agentId", "toolKey");

-- CreateIndex
CREATE INDEX "activity_events_agentId_destination_idx" ON "activity_events"("agentId", "destination");

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_organizationId_agentId_clientEventId_key" ON "activity_events"("organizationId", "agentId", "clientEventId");

-- Pre-P1 parentEventId values were never written by the app; clear any that
-- don't reference a real event (e.g. hand-inserted seed data) so the new
-- foreign key can be added. Runs before the immutability trigger exists.
UPDATE "activity_events" c SET "parentEventId" = NULL
WHERE c."parentEventId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "activity_events" p WHERE p."id" = c."parentEventId" AND p."organizationId" = c."organizationId");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "activity_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "policy_evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfills (deterministic derivations of data already stored — no guessing)
-- ---------------------------------------------------------------------------

-- toolKey = lib/telemetry/normalize.ts#normalizeKey(toolName), mirrored in SQL:
-- lowercase, runs of [^a-z0-9._-] -> "-", collapse "--", trim "-", max 60.
UPDATE "activity_events"
SET "toolKey" = NULLIF(
  btrim(left(btrim(regexp_replace(regexp_replace(lower(btrim("toolName")), '[^a-z0-9._-]+', '-', 'g'), '-{2,}', '-', 'g'), '-'), 60), '-'),
  '')
WHERE "toolName" IS NOT NULL AND "toolKey" IS NULL;

-- outcome for rows an agent reported via POST /api/v1/events: the reported
-- result is exactly what `status` was mapped from at ingest. Decision rows
-- (source = 'policy_evaluation') stay NULL — nothing executed. Environment is
-- deliberately NOT backfilled: the agent's environment at the time of a
-- historical event is unknown.
UPDATE "activity_events"
SET "outcome" = CASE "status"
    WHEN 'ALLOWED' THEN 'SUCCESS'::"EventOutcome"
    WHEN 'FAILED' THEN 'FAILURE'::"EventOutcome"
    WHEN 'BLOCKED' THEN 'BLOCKED'::"EventOutcome"
    WHEN 'WARNING' THEN 'WARNING'::"EventOutcome"
  END
WHERE "source" = 'api' AND "outcome" IS NULL AND "status" IN ('ALLOWED', 'FAILED', 'BLOCKED', 'WARNING');

-- ---------------------------------------------------------------------------
-- Immutability: security evidence is append-only at the database level.
--
-- Rows may still be INSERTed and DELETEd (organization deletion, future
-- retention). An UPDATE is rejected unless every changed column is either:
--   - the table's single "link once" column going NULL -> value
--     (activity_events.parentEventId: a late-arriving parent), or
--   - a foreign key being nulled by ON DELETE SET NULL.
-- This holds for every database client, not just this application's code.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "aegis_enforce_append_only"() RETURNS trigger AS $$
DECLARE
  link_once_column text := NULLIF(TG_ARGV[0], '');
  nullable_columns text[] := COALESCE(TG_ARGV[1]::text[], ARRAY[]::text[]);
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
      RAISE EXCEPTION 'aegis: % rows are append-only security evidence; column "%" cannot be modified', TG_TABLE_NAME, col
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activity_events_append_only"
  BEFORE UPDATE ON "activity_events"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('parentEventId', '{parentEventId,evaluationId}');

CREATE TRIGGER "policy_evaluations_append_only"
  BEFORE UPDATE ON "policy_evaluations"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{activityEventId}');

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{actorUserId,agentId}');

CREATE TRIGGER "approval_decisions_append_only"
  BEFORE UPDATE ON "approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{}');

CREATE TRIGGER "security_alert_occurrences_append_only"
  BEFORE UPDATE ON "security_alert_occurrences"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{}');
