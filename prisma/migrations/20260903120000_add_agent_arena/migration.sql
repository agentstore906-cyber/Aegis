-- Agent Arena — additive only. Creates new isolated tables and one new
-- enum. Touches no existing table, column, enum, constraint, or data.

-- CreateEnum
CREATE TYPE "ArenaScorecardStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "arena_scorecards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "ArenaScorecardStatus" NOT NULL DEFAULT 'PENDING',
    "benchmarkVersion" TEXT NOT NULL DEFAULT 'v1',
    "overallScore" INTEGER,
    "categoryScores" JSONB,
    "metrics" JSONB,
    "errorMessage" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "publishedAt" TIMESTAMP(3),
    "displayName" TEXT,
    "challengedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "arena_scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_scenario_results" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scenarioKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_scenario_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_challenge_attributions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedAt" TIMESTAMP(3),
    "resultId" TEXT,

    CONSTRAINT "arena_challenge_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_analytics_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "organizationId" TEXT,
    "scorecardId" TEXT,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arena_scorecards_publicSlug_key" ON "arena_scorecards"("publicSlug");

-- CreateIndex
CREATE INDEX "arena_scorecards_organizationId_createdAt_idx" ON "arena_scorecards"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "arena_scorecards_agentId_createdAt_idx" ON "arena_scorecards"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "arena_scorecards_challengedFromId_idx" ON "arena_scorecards"("challengedFromId");

-- CreateIndex
CREATE INDEX "arena_scenario_results_scorecardId_idx" ON "arena_scenario_results"("scorecardId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_challenge_attributions_token_key" ON "arena_challenge_attributions"("token");

-- CreateIndex
CREATE INDEX "arena_challenge_attributions_createdAt_idx" ON "arena_challenge_attributions"("createdAt");

-- CreateIndex
CREATE INDEX "arena_analytics_events_event_createdAt_idx" ON "arena_analytics_events"("event", "createdAt");

-- CreateIndex
CREATE INDEX "arena_analytics_events_scorecardId_idx" ON "arena_analytics_events"("scorecardId");

-- AddForeignKey
ALTER TABLE "arena_scorecards" ADD CONSTRAINT "arena_scorecards_challengedFromId_fkey" FOREIGN KEY ("challengedFromId") REFERENCES "arena_scorecards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_scenario_results" ADD CONSTRAINT "arena_scenario_results_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "arena_scorecards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
