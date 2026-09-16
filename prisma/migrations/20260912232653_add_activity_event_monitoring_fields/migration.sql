-- AlterEnum
ALTER TYPE "ActivityStatus" ADD VALUE 'WARNING';

-- AlterTable
ALTER TABLE "activity_events" ADD COLUMN     "description" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'api',
ADD COLUMN     "toolName" TEXT;
