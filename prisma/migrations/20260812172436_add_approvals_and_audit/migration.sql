-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'AGENT');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "policyEvaluationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "environment" "Environment",
    "tool" TEXT,
    "riskLevel" "RiskLevel",
    "context" JSONB,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "traceId" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "agentId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_policyEvaluationId_key" ON "approval_requests"("policyEvaluationId");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_requestedAt_idx" ON "approval_requests"("organizationId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "approval_requests_agentId_status_idx" ON "approval_requests"("agentId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_traceId_idx" ON "approval_requests"("traceId");

-- CreateIndex
CREATE INDEX "approval_decisions_approvalRequestId_idx" ON "approval_decisions"("approvalRequestId");

-- CreateIndex
CREATE INDEX "approval_decisions_organizationId_createdAt_idx" ON "approval_decisions"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_createdAt_idx" ON "audit_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_eventType_idx" ON "audit_events"("organizationId", "eventType");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_entityType_entityId_idx" ON "audit_events"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_traceId_idx" ON "audit_events"("traceId");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policyEvaluationId_fkey" FOREIGN KEY ("policyEvaluationId") REFERENCES "policy_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
