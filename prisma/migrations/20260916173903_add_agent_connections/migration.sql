-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('OPENAI', 'ANTHROPIC', 'CUSTOM_SDK');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTING', 'VERIFYING', 'CONNECTED', 'DEGRADED', 'RECONNECT_REQUIRED', 'DISCONNECTED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "connectorType" "ConnectorType" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "externalAccountLabel" TEXT,
    "externalAgentId" TEXT,
    "credentialCiphertext" TEXT,
    "credentialIv" TEXT,
    "credentialAuthTag" TEXT,
    "apiKeyId" TEXT,
    "capabilities" JSONB NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_agentId_key" ON "agent_connections"("agentId");

-- CreateIndex
CREATE INDEX "agent_connections_organizationId_status_idx" ON "agent_connections"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_connections_apiKeyId_idx" ON "agent_connections"("apiKeyId");

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
