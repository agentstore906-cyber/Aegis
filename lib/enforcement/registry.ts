import type { Agent } from "@prisma/client";
import type { EnforcementConnector } from "@/lib/enforcement/types";
import { NullEnforcementConnector } from "@/lib/enforcement/null-connector";

const nullConnector = new NullEnforcementConnector();

/**
 * Resolves which connector applies to a given agent. Always the null
 * connector today — there is nothing on the `Agent` model yet describing an
 * integration capable of real enforcement. Future connectors (e.g. one
 * backed by the agent-sdk's own polling of its control state) would branch
 * on `agent.framework`/a future `integrationId` here; call sites never need
 * to change, only this resolver.
 */
export function getEnforcementConnector(_agent: Pick<Agent, "id">): EnforcementConnector {
  return nullConnector;
}
