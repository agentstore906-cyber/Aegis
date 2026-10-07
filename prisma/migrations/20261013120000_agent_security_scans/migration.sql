-- Security scans of a real, connected agent (see docs/AEGIS_REAL_AGENT_IDENTITY.md). Additive only.
CREATE TABLE "agent_security_scans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstHandshakeAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "observations" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "findingCount" INTEGER NOT NULL,

    CONSTRAINT "agent_security_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_security_scans_agentId_createdAt_idx" ON "agent_security_scans"("agentId", "createdAt");
CREATE INDEX "agent_security_scans_organizationId_createdAt_idx" ON "agent_security_scans"("organizationId", "createdAt");

ALTER TABLE "agent_security_scans" ADD CONSTRAINT "agent_security_scans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_security_scans" ADD CONSTRAINT "agent_security_scans_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
