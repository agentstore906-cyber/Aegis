import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { getAgentBySlugRaw } from "@/lib/agents/queries";
import type { AgentRegisterInput } from "@/lib/validation/api";

const DEFAULT_OWNER = "API";
const DEFAULT_MODEL_PROVIDER = "unknown";
const DEFAULT_MODEL_NAME = "unknown";

/**
 * Used by POST /api/v1/agents/register — deliberately an upsert-by-name,
 * not a "create another agent" operation like the dashboard's create-agent
 * form (which reuses lib/agents/queries.ts#ensureUniqueAgentSlug to always
 * mint a fresh, non-colliding slug). An SDK calling register() repeatedly
 * for the same agent name should get the *same* agent back every time, so
 * the quickstart flow doesn't scatter duplicate agents across retries.
 */
export async function registerAgent(organizationId: string, input: AgentRegisterInput) {
  const slug = slugify(input.name);

  const existing = await getAgentBySlugRaw(organizationId, slug);
  if (existing) return { agent: existing, created: false };

  try {
    const agent = await prisma.agent.create({
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
