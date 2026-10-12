import "server-only";

import type { PrismaOrTx } from "@/lib/db";

/**
 * The ONE definition of "how many agents does this organization have against its plan's agent limit".
 *
 * Every agent counts — including retired (ARCHIVED) ones. This is deliberate and used by every creation path (Connect
 * Agent, the SDK connect flow, POST /api/v1/agents/register), the race-safe guard, and every page that shows usage, so
 * the number a user sees is the number that is enforced. Retired agents keep their history and credentials; letting an
 * archive release a slot would let a Free organization cycle unlimited agents through three slots. There is also no
 * user-facing way to archive or delete an agent today, so nothing is stuck by this.
 */
export function countAgentsTowardLimit(client: PrismaOrTx, organizationId: string): Promise<number> {
  return client.agent.count({ where: { organizationId } });
}

/** How many of the counted agents are retired — only used to explain the count to the user. */
export function countRetiredAgents(client: PrismaOrTx, organizationId: string): Promise<number> {
  return client.agent.count({ where: { organizationId, status: "ARCHIVED" } });
}
