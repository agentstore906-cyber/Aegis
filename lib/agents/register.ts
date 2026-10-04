import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { getAgentBySlugRaw } from "@/lib/agents/queries";
import { AgentLimitReachedError, checkAgentLimitLocked } from "@/lib/agents/creation-guard";
import { apiKeyMayActAsAgent, apiKeyMayRegisterAgents, type KeyBinding } from "@/lib/api-keys/agent-binding";
import type { AgentRegisterInput } from "@/lib/validation/api";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

/** The key doing the registering. Its id is recorded in the audit trail as `keyId` (never the secret; note a field named like `apiKey…` would be masked by redaction). */
export type RegisterKey = KeyBinding & { apiKeyId?: string };

const DEFAULT_OWNER = "API";
const DEFAULT_MODEL_PROVIDER = "unknown";
const DEFAULT_MODEL_NAME = "unknown";

export class AgentRegistrationNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistrationNotAuthorizedError";
  }
}

/**
 * Used by POST /api/v1/agents/register — deliberately an upsert-by-name,
 * not a "create another agent" operation like the dashboard's create-agent
 * form (which reuses lib/agents/queries.ts#ensureUniqueAgentSlug to always
 * mint a fresh, non-colliding slug). An SDK calling register() repeatedly
 * for the same agent name should get the *same* agent back every time, so
 * the quickstart flow doesn't scatter duplicate agents across retries.
 *
 * P0 rules:
 *   - Returning an existing agent never changes it and never counts against
 *     the plan — existing agents keep working at or over the limit.
 *   - A key bound to one agent may "register" only that same agent (the
 *     idempotent quickstart call); it can neither see nor create others.
 *   - Creating a new agent requires an organization-wide key and passes the
 *     plan's agent limit, checked under a per-org lock in the same
 *     transaction as the insert (lib/agents/creation-guard.ts).
 */
export async function registerAgent(organizationId: string, input: AgentRegisterInput, key: RegisterKey) {
  const slug = slugify(input.name);

  const existing = await getAgentBySlugRaw(organizationId, slug);
  if (existing) {
    if (!apiKeyMayActAsAgent(key, existing)) {
      throw new AgentRegistrationNotAuthorizedError(
        "This API key is bound to a different agent and cannot register or access other agents."
      );
    }
    return { agent: existing, created: false };
  }

  if (!apiKeyMayRegisterAgents(key)) {
    throw new AgentRegistrationNotAuthorizedError(
      "This API key is bound to a single agent and cannot register new agents. Use an organization-wide key."
    );
  }

  try {
    const agent = await prisma.$transaction(async (tx) => {
      const entitlement = await checkAgentLimitLocked(tx, organizationId);
      if (!entitlement.allowed) throw new AgentLimitReachedError(entitlement.reason);

      const created = await tx.agent.create({
        data: {
          organizationId,
          name: input.name,
          slug,
          owner: input.owner || DEFAULT_OWNER,
          modelProvider: input.modelProvider || DEFAULT_MODEL_PROVIDER,
          modelName: input.modelName || DEFAULT_MODEL_NAME,
          environment: input.environment,
          riskLevel: input.riskLevel,
        },
      });
      // An agent entering the organization is the first lifecycle transition. It happens in the same
      // transaction as the insert, so an agent can never exist without its "created" record.
      await recordAuditEvent(tx, {
        organizationId,
        actorType: "SYSTEM",
        agentId: created.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_CREATED,
        entityType: "Agent",
        entityId: created.id,
        action: "agent.register",
        metadata: { via: "api_register", keyId: key.apiKeyId, environment: created.environment, owner: created.owner },
      });
      return created;
    });
    return { agent, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Two concurrent register() calls for the same brand-new name — the
      // loser just reads back what the winner created.
      const race = await getAgentBySlugRaw(organizationId, slug);
      if (race) return { agent: race, created: false };
    }
    throw error;
  }
}
