-- CreateEnum
CREATE TYPE "SecurityAlertConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- AlterEnum
ALTER TYPE "AgentStatus" ADD VALUE 'STOPPED';

-- AlterTable
ALTER TABLE "security_alerts" ADD COLUMN     "confidence" "SecurityAlertConfidence",
ADD COLUMN     "recommendedAction" TEXT;

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT,
    "period" "BudgetPeriod" NOT NULL,
    "limitCents" INTEGER NOT NULL,
    "warningThresholdPercent" INTEGER NOT NULL DEFAULT 80,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_organizationId_agentId_idx" ON "budgets"("organizationId", "agentId");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
