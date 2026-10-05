import "server-only";

import type { ApiKey } from "@prisma/client";

import { ApiError } from "@/lib/api/errors";
import { getAgentBySlugForIngestion } from "@/lib/agents/queries";
import { prisma } from "@/lib/db";
import { apiKeyMayActAsAgent } from "@/lib/api-keys/agent-binding";

/**
 * Resolves the agent a public-API request is for and verifies the authenticated key may act as it (P0 §7).
 * The org is always the key's org.
 *
 *   - A key bound to one agent IS that agent's identity: when the request omits `agent`, the agent is the
 *     key's agent, so a customer never has to know or paste an agent identifier. When the request names an
 *     agent, the name is only a claim and must be the key's own agent (403 AGENT_NOT_AUTHORIZED otherwise).
 *   - An organization-wide key cannot say which agent is calling, so it must name one (400 AGENT_REQUIRED).
 *
 * Shared by /events, /evaluate and /simulate so the rule lives once.
 */
export async function resolveAuthorizedAgent(apiKey: ApiKey, organizationId: string, agentSlug?: string) {
  if (!agentSlug) {
    if (!apiKey.agentId) {
      throw new ApiError("AGENT_REQUIRED", "This key is organization-wide, so the request must name the agent with `agent`.", 400);
    }
    const own = await prisma.agent.findFirst({
      where: { id: apiKey.agentId, organizationId },
      include: { connection: { select: { status: true } } },
    });
    if (!own) throw new ApiError("AGENT_NOT_FOUND", "The agent this key is bound to was not found in this organization.", 404);
    return own;
  }

  const agent = await getAgentBySlugForIngestion(organizationId, agentSlug);
  if (!agent) {
    throw new ApiError("AGENT_NOT_FOUND", `Agent \`${agentSlug}\` was not found in this organization.`, 404);
  }
  if (!apiKeyMayActAsAgent({ agentId: apiKey.agentId, organizationId: apiKey.organizationId }, agent)) {
    throw new ApiError(
      "AGENT_NOT_AUTHORIZED",
      `This API key is bound to a different agent and is not authorized to act as \`${agentSlug}\`.`,
      403
    );
  }
  return agent;
}
