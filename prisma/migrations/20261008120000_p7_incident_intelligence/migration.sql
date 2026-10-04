-- P7 — Incident intelligence. See docs/AEGIS_P7_INCIDENT_INTELLIGENCE.md.
-- Additive: two tables. An incident is a thin handle on existing evidence
-- (anchor + run + the operator's handling); timeline, summary and evidence are
-- reconstructed on read, so nothing here duplicates or can contradict the
-- security records. No backfill: incidents exist from deployment onward (open
-- one from any security alert or decision to investigate older activity).
--
-- Evidence-preservation guarantees enforced by the database itself:
--   * incident_activity (opened / acknowledged / status changes / notes) is
--     append-only — no UPDATE (aegis_enforce_append_only from P1);
--   * an incident's anchor, run, number and origin can never be rewritten
--     (aegis_incident_anchor_immutable below). Only its handling state
--     (status, acknowledgement, severity, title sync) changes.

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "IncidentActivityKind" AS ENUM ('OPENED', 'ACKNOWLEDGED', 'STATUS_CHANGED', 'NOTE');

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "clusterKey" TEXT NOT NULL,
    "anchorType" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "traceId" TEXT,
    "title" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedVia" TEXT NOT NULL,
    "openedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_activity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "IncidentActivityKind" NOT NULL,
    "fromStatus" "IncidentStatus",
    "toStatus" "IncidentStatus",
    "actorUserId" TEXT,
    "note" TEXT,
    "evidenceDigest" TEXT,
    "evidenceCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_organizationId_status_openedAt_idx" ON "incidents"("organizationId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "incidents_organizationId_openedAt_idx" ON "incidents"("organizationId", "openedAt");

-- CreateIndex
CREATE INDEX "incidents_agentId_openedAt_idx" ON "incidents"("agentId", "openedAt");

-- CreateIndex
CREATE INDEX "incidents_traceId_idx" ON "incidents"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_organizationId_agentId_clusterKey_key" ON "incidents"("organizationId", "agentId", "clusterKey");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_organizationId_number_key" ON "incidents"("organizationId", "number");

-- CreateIndex
CREATE INDEX "incident_activity_incidentId_createdAt_idx" ON "incident_activity"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "incident_activity_organizationId_createdAt_idx" ON "incident_activity"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_activity" ADD CONSTRAINT "incident_activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_activity" ADD CONSTRAINT "incident_activity_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

CREATE TRIGGER "incident_activity_append_only"
  BEFORE UPDATE ON "incident_activity"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{}');

CREATE OR REPLACE FUNCTION "aegis_incident_anchor_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."clusterKey" IS DISTINCT FROM OLD."clusterKey"
     OR NEW."anchorType" IS DISTINCT FROM OLD."anchorType"
     OR NEW."anchorId" IS DISTINCT FROM OLD."anchorId"
     OR NEW."traceId" IS DISTINCT FROM OLD."traceId"
     OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt"
     OR NEW."openedVia" IS DISTINCT FROM OLD."openedVia"
     OR NEW."openedByUserId" IS DISTINCT FROM OLD."openedByUserId" THEN
    RAISE EXCEPTION 'aegis: an incident''s anchor, run and origin are immutable evidence and cannot be modified'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incidents_anchor_immutable"
  BEFORE UPDATE ON "incidents"
  FOR EACH ROW EXECUTE FUNCTION "aegis_incident_anchor_immutable"();
