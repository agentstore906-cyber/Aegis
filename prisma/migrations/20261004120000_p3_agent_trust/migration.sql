-- P3 — Agent trust. See docs/AEGIS_P3_AGENT_TRUST.md.
-- Additive: two enums and two tables (current trust state, append-only
-- trust transitions). No backfill: an agent's trust is computed from its
-- existing evidence the first time it is evaluated. New API keys get the
-- `trust:read` scope by default; existing keys are NOT changed.

-- CreateEnum
CREATE TYPE "TrustState" AS ENUM ('TRUSTED', 'NORMAL', 'DEGRADED', 'HIGH_RISK', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "TrustTrigger" AS ENUM ('ACTIVITY_EVENT', 'POLICY_EVALUATION', 'APPROVAL_DECISION', 'SECURITY_ALERT', 'OPERATOR_CONTROL', 'SCHEDULED', 'ON_DEMAND');

-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET DEFAULT ARRAY['events:write', 'policy:evaluate', 'approvals:read', 'behavior:read', 'trust:read']::TEXT[];

-- CreateTable
CREATE TABLE "agent_trust_states" (
    "agentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" "TrustState" NOT NULL,
    "score" INTEGER NOT NULL,
    "stateSince" TIMESTAMP(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "methodologyVersion" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "categories" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_trust_states_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "agent_trust_transitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "previousState" "TrustState",
    "newState" "TrustState" NOT NULL,
    "previousScore" INTEGER,
    "newScore" INTEGER NOT NULL,
    "trigger" "TrustTrigger" NOT NULL,
    "triggerRef" TEXT,
    "summary" TEXT NOT NULL,
    "factors" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "methodologyVersion" INTEGER NOT NULL,

    CONSTRAINT "agent_trust_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_trust_states_organizationId_state_idx" ON "agent_trust_states"("organizationId", "state");

-- CreateIndex
CREATE INDEX "agent_trust_transitions_organizationId_agentId_occurredAt_idx" ON "agent_trust_transitions"("organizationId", "agentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_trust_transitions_agentId_sequence_key" ON "agent_trust_transitions"("agentId", "sequence");

-- AddForeignKey
ALTER TABLE "agent_trust_states" ADD CONSTRAINT "agent_trust_states_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_trust_states" ADD CONSTRAINT "agent_trust_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_trust_transitions" ADD CONSTRAINT "agent_trust_transitions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_trust_transitions" ADD CONSTRAINT "agent_trust_transitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only trust history (reuses the P1/P2 trigger function). No column
-- of a transition may ever change: not the states, the score, the trigger,
-- the explanation, or the factor snapshot. Corrections are new transitions.
-- ---------------------------------------------------------------------------
CREATE TRIGGER "agent_trust_transitions_append_only"
  BEFORE UPDATE ON "agent_trust_transitions"
  FOR EACH ROW EXECUTE FUNCTION "aegis_enforce_append_only"('', '{}');
