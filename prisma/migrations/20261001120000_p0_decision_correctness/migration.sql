-- P0 decision & security correctness. See docs/AEGIS_P0_IMPLEMENTATION.md.
-- Schema changes are additive (new nullable columns / defaults / tables);
-- data backfills at the bottom are conservative and idempotent.

-- DropIndex
DROP INDEX "security_alerts_agentId_type_idx";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "legacyPolicyMatching" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "agent_connections" ADD COLUMN     "credentialKeyId" TEXT;

-- AlterTable
ALTER TABLE "policy_evaluations" ADD COLUMN     "agentStatus" "AgentStatus",
ADD COLUMN     "claimedEnvironment" "Environment",
ADD COLUMN     "claimedRiskLevel" "RiskLevel",
ADD COLUMN     "consumedApprovalRequestId" TEXT,
ADD COLUMN     "decisionSource" TEXT,
ADD COLUMN     "matchingMode" TEXT;

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "consumedByEvaluationId" TEXT,
ADD COLUMN     "executionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "requestFingerprint" TEXT;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "idempotency_records" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "security_alerts" ADD COLUMN     "dedupeKey" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "security_alert_occurrences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "SecurityAlertSeverity" NOT NULL,
    "confidence" "SecurityAlertConfidence",
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "traceId" TEXT,

    CONSTRAINT "security_alert_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE INDEX "security_alert_occurrences_alertId_occurredAt_idx" ON "security_alert_occurrences"("alertId", "occurredAt");

-- CreateIndex
CREATE INDEX "security_alert_occurrences_organizationId_occurredAt_idx" ON "security_alert_occurrences"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_consumedByEvaluationId_key" ON "approval_requests"("consumedByEvaluationId");

-- CreateIndex
CREATE INDEX "api_keys_agentId_idx" ON "api_keys"("agentId");

-- CreateIndex
CREATE INDEX "security_alerts_agentId_type_dedupeKey_idx" ON "security_alerts"("agentId", "type", "dedupeKey");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alert_occurrences" ADD CONSTRAINT "security_alert_occurrences_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "security_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data backfills
-- ---------------------------------------------------------------------------

-- (3) Approval expiration. Pre-P0 requests were created with no deadline.
-- Give every still-PENDING legacy request a real deadline, but never one
-- in the past: at least 24h from now, so the migration itself doesn't
-- mass-expire requests a human may be about to look at.
UPDATE "approval_requests"
SET "expiresAt" = GREATEST("requestedAt" + INTERVAL '24 hours', (now() AT TIME ZONE 'UTC') + INTERVAL '24 hours')
WHERE "status" = 'PENDING' AND "expiresAt" IS NULL;
-- Legacy APPROVED requests are deliberately left with requestFingerprint
-- NULL: they can never be consumed by the new single-use execution path
-- (lib/policies/evaluate.ts), so no historical approval becomes a
-- reusable bearer token.

-- (7) Agent binding for API keys that Aegis itself provisioned for one
-- agent's SDK connection (AgentConnection.apiKeyId). Only binds a key that
-- exactly one connection references; organization-wide keys created from
-- Developers > API Keys stay organization-wide.
UPDATE "api_keys" k
SET "agentId" = c."agentId"
FROM "agent_connections" c
WHERE c."apiKeyId" = k."id"
  AND k."agentId" IS NULL
  AND (SELECT COUNT(*) FROM "agent_connections" c2 WHERE c2."apiKeyId" = k."id") = 1;

-- (6) Idempotency: every pre-existing record was written only after its
-- handler completed.
UPDATE "idempotency_records" SET "completedAt" = "createdAt" WHERE "completedAt" IS NULL;

-- (5) Alert evidence: record each existing alert's current evidence as an
-- occurrence so the new occurrence history starts complete from here on.
-- (Evidence already overwritten by the pre-P0 dedup cannot be recovered.)
INSERT INTO "security_alert_occurrences" ("id", "organizationId", "alertId", "occurredAt", "severity", "confidence", "title", "description", "evidence", "traceId")
SELECT 'p0backfill_' || a."id", a."organizationId", a."id", a."lastSeenAt", a."severity", a."confidence", a."title", a."description", a."evidence", a."traceId"
FROM "security_alerts" a
WHERE NOT EXISTS (SELECT 1 FROM "security_alert_occurrences" o WHERE o."alertId" = a."id");
