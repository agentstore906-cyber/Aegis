import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { getEnforcementConnector } from "@/lib/enforcement/registry";
import type { AgentControlAction, EnforcementOutcome } from "@/lib/enforcement/types";

export type AgentControlState = "ACTIVE" | "PAUSED" | "STOPPED";

const CONTROL_STATE_TO_ACTION: Record<AgentControlState, AgentControlAction> = {
  ACTIVE: "resume",
  PAUSED: "pause",
  STOPPED: "stop",
};

const CONTROL_STATE_TO_AUDIT_EVENT = {
  PAUSED: AUDIT_EVENT_TYPES.AGENT_PAUSED,
  ACTIVE: AUDIT_EVENT_TYPES.AGENT_RESUMED,
  STOPPED: AUDIT_EVENT_TYPES.AGENT_STOPPED,
} as const;

const CONTROL_STATE_TO_WEBHOOK_EVENT = {
  PAUSED: "agent.paused",
  ACTIVE: "agent.resumed",
  STOPPED: "agent.stopped",
} as const;

export class AgentNotFoundError extends Error {
  constructor() {
    super("Agent not found.");
    this.name = "AgentNotFoundError";
  }
}

export class AgentArchivedError extends Error {
  constructor() {
    super("This agent is archived and can no longer be controlled.");
    this.name = "AgentArchivedError";
  }
}

export type SetAgentControlStateResult = {
  agentId: string;
  agentSlug: string;
  previousStatus: string;
  newStatus: AgentControlState;
  outcome: EnforcementOutcome;
};

/**
 * The kill switch's actual logic, split out from the "use server" Action
 * (lib/agents/actions.ts#setAgentStatusAction) so it's testable without a
 * session — same service/action split as lib/approvals/service.ts. Changes
 * Aegis's *recorded* control state for an agent — PAUSED and STOPPED both
 * mean "Aegis wants this agent to stop acting," STOPPED being the stronger
 * operator signal (see the AgentStatus enum comment in schema.prisma).
 * Also asks the enforcement connector (lib/enforcement/) whether that
 * intent was actually made real on the external agent — today it never is
 * (see NullEnforcementConnector) — and always reports that truthfully via
 * the returned `outcome`, never implying otherwise. Every transition is
 * audited, including who did it and whether it was enforced.
 */
export async function setAgentControlState(
  organizationId: string,
  agentSlug: string,
  status: AgentControlState,
  actorUserId: string,
  reason?: string
): Promise<SetAgentControlStateResult> {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug: agentSlug } },
  });
  if (!agent) throw new AgentNotFoundError();
  if (agent.status === "ARCHIVED") throw new AgentArchivedError();

  const connector = getEnforcementConnector(agent);
  const outcome = await connector.control(agent.id, CONTROL_STATE_TO_ACTION[status]);

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agent.id }, data: { status } });

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId,
      agentId: agent.id,
      eventType: CONTROL_STATE_TO_AUDIT_EVENT[status],
      entityType: "Agent",
      entityId: agent.id,
      action: `agent.${CONTROL_STATE_TO_ACTION[status]}`,
      metadata: {
        previousStatus: agent.status,
        newStatus: status,
        reason: reason || undefined,
        enforced: outcome.enforced,
        enforcementMechanism: outcome.mechanism,
      },
    });
  });

  await dispatchWebhookEvent(organizationId, CONTROL_STATE_TO_WEBHOOK_EVENT[status], {
    agentId: agent.id,
    agentName: agent.name,
    enforced: outcome.enforced,
  });

  return {
    agentId: agent.id,
    agentSlug: agent.slug,
    previousStatus: agent.status,
    newStatus: status,
    outcome,
  };
}
