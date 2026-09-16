-- AlterEnum
ALTER TYPE "PolicyDecision" ADD VALUE 'ALERT';

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "severity" "SecurityAlertSeverity" NOT NULL DEFAULT 'MEDIUM';
