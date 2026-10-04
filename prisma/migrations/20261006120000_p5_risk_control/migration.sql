-- P5 — Risk-driven control. See docs/AEGIS_P5_CONTROL.md.
-- Additive. Every organization starts in OBSERVE (risk is recorded, nothing
-- is enforced), so applying this migration changes no decision. New nullable
-- decision-record columns on policy_evaluations (append-only table: values are
-- written with the INSERT) and an operator review-label table.
-- The final RenameIndex only normalizes the P4 index name to Prisma's own.

-- CreateEnum
CREATE TYPE "RiskControlMode" AS ENUM ('OBSERVE', 'APPROVAL_REQUIRED', 'ENFORCE');

-- CreateEnum
CREATE TYPE "RiskReviewLabelValue" AS ENUM ('JUSTIFIED', 'FALSE_POSITIVE', 'UNSURE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "riskControlMode" "RiskControlMode" NOT NULL DEFAULT 'OBSERVE',
ADD COLUMN     "riskHighAction" "PolicyDecision" NOT NULL DEFAULT 'REQUIRE_APPROVAL',
ADD COLUMN     "riskMediumAction" "PolicyDecision" NOT NULL DEFAULT 'ALERT';

-- AlterTable
ALTER TABLE "policy_evaluations" ADD COLUMN     "policyDecision" "PolicyDecision",
ADD COLUMN     "riskControl" JSONB,
ADD COLUMN     "riskControlMode" "RiskControlMode",
ADD COLUMN     "riskControlOutcome" TEXT;

-- CreateTable
CREATE TABLE "risk_review_labels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "label" "RiskReviewLabelValue" NOT NULL,
    "note" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_review_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_review_labels_evaluationId_key" ON "risk_review_labels"("evaluationId");

-- CreateIndex
CREATE INDEX "risk_review_labels_organizationId_label_idx" ON "risk_review_labels"("organizationId", "label");

-- CreateIndex
CREATE INDEX "policy_evaluations_organizationId_riskControlOutcome_create_idx" ON "policy_evaluations"("organizationId", "riskControlOutcome", "createdAt");

-- AddForeignKey
ALTER TABLE "risk_review_labels" ADD CONSTRAINT "risk_review_labels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_review_labels" ADD CONSTRAINT "risk_review_labels_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "policy_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "policy_evaluations_organizationId_riskShadowOutcome_createdAt_i" RENAME TO "policy_evaluations_organizationId_riskShadowOutcome_created_idx";

