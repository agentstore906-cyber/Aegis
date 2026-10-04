-- Free AI Agent Risk Scanner (docs/AEGIS_FREE_RISK_SCANNER.md) — additive only.
-- Creates two new isolated tables. Touches no existing table, column, enum or data.
-- No foreign keys by design (same isolation as Agent Arena). Pasted scanner input is never stored.

-- CreateTable
CREATE TABLE "risk_scans" (
    "id" TEXT NOT NULL,
    "sessionHash" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "connectedAgentId" TEXT,
    "agentType" TEXT NOT NULL,
    "agentLabel" TEXT,
    "capabilities" JSONB NOT NULL,
    "autonomy" JSONB NOT NULL,
    "controls" JSONB NOT NULL,
    "inputSignals" JSONB,
    "engineVersion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "highRiskCount" INTEGER NOT NULL,
    "mediumCount" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_analytics_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "visitorHash" TEXT,
    "scanId" TEXT,
    "organizationId" TEXT,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_scans_publicSlug_key" ON "risk_scans"("publicSlug");

-- CreateIndex
CREATE INDEX "risk_scans_sessionHash_idx" ON "risk_scans"("sessionHash");

-- CreateIndex
CREATE INDEX "risk_scans_organizationId_createdAt_idx" ON "risk_scans"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "risk_scans_expiresAt_idx" ON "risk_scans"("expiresAt");

-- CreateIndex
CREATE INDEX "scanner_analytics_events_event_createdAt_idx" ON "scanner_analytics_events"("event", "createdAt");

-- CreateIndex
CREATE INDEX "scanner_analytics_events_scanId_idx" ON "scanner_analytics_events"("scanId");
