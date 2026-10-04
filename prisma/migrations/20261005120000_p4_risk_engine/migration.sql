-- P4 — Unified risk engine (shadow mode). See docs/AEGIS_P4_RISK_ENGINE.md.
-- Additive and nullable: four columns on policy_evaluations holding the risk
-- explanation computed alongside each decision. No backfill (older decisions
-- were made without the engine), no default, nothing enforced. The existing
-- append-only trigger is unaffected: values are written with the INSERT.

-- AlterTable
ALTER TABLE "policy_evaluations" ADD COLUMN "riskAssessment" JSONB,
ADD COLUMN "riskAssessedLevel" "RiskLevel",
ADD COLUMN "riskRecommendedDecision" "PolicyDecision",
ADD COLUMN "riskShadowOutcome" TEXT;

-- CreateIndex
CREATE INDEX "policy_evaluations_organizationId_riskShadowOutcome_createdAt_idx" ON "policy_evaluations"("organizationId", "riskShadowOutcome", "createdAt");
