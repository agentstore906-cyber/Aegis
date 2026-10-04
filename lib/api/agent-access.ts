import "server-only";

import type { ApiKey } from "@prisma/client";

import { ApiError } from "@/lib/api/errors";
import { getAgentBySlugForIngestion } from "@/lib/agents/queries";
import { apiKeyMayActAsAgent } from "@/lib/api-keys/agent-binding";

/**
 * Resolves the agent a public-API request names and verifies the
 * authenticated key may act as it (P0 §7). The org is always the key's
 * org; a key bound to one agent gets 403 AGENT_NOT_AUTHORIZED for any
 * other agent. Shared by /events and /evaluate so the rule lives once.
 */
export async function resolveAuthorizedAgent(apiKey: ApiKey, organizationId: string, agentSlug: string) {
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
