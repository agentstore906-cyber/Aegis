-- Aegis connects TO an external agent (aegis-agent/1). Additive only. See docs/AEGIS_AGENT_ENDPOINT_PROTOCOL.md.
ALTER TYPE "ConnectorType" ADD VALUE 'AEGIS_ENDPOINT';

ALTER TABLE "agent_connections" ADD COLUMN "endpointUrl" TEXT;
-- One connection per endpoint per organization (NULLs, i.e. non-endpoint connections, never collide).
CREATE UNIQUE INDEX "agent_connections_organizationId_endpointUrl_key" ON "agent_connections"("organizationId", "endpointUrl");

ALTER TABLE "agent_security_scans" ADD COLUMN "endpointTests" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "agent_security_scans" ADD COLUMN "notTested" JSONB NOT NULL DEFAULT '[]';
