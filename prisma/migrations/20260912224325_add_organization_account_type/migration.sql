-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PERSONAL', 'TEAM', 'ENTERPRISE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'TEAM';
