import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { getEnforcementConnector } from "@/lib/enforcement/registry";
import { canResumeStoppedAgent } from "@/lib/agents/authorization";
import type { MemberRole } from "@prisma/client";
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

export class AgentResumeForbiddenError extends Error {
  constructor() {
    super("This agent was STOPPED. Only owners, admins and security members can resume a stopped agent; use Pause for temporary holds.");
    this.name = "AgentResumeForbiddenError";
  }
}

export class AgentStatusConflictError extends Error {
  constructor() {
    super("This agent's status changed while you were acting. Reload and try again.");
    this.name = "AgentStatusConflictError";
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
  reason?: string,
  options: { actorRole?: MemberRole } = {}
): Promise<SetAgentControlStateResult> {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug: agentSlug } },
  });
  if (!agent) throw new AgentNotFoundError();
  if (agent.status === "ARCHIVED") throw new AgentArchivedError();
  // Separation of duties: leaving STOPPED needs resolve_security (the action layer always passes the actor's role).
  if (options.actorRole && agent.status === "STOPPED" && status !== "STOPPED" && !canResumeStoppedAgent(options.actorRole)) {
    throw new AgentResumeForbiddenError();
  }

  const connector = getEnforcementConnector(agent);
  const outcome = await connector.control(agent.id, CONTROL_STATE_TO_ACTION[status]);

  await prisma.$transaction(async (tx) => {
    // Compare-and-set on the status that was checked above, so a concurrent change (or the check it relied on) can never be overwritten.
    const moved = await tx.agent.updateMany({ where: { id: agent.id, organizationId, status: agent.status }, data: { status } });
    if (moved.count !== 1) throw new AgentStatusConflictError();

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

  // Trust (P3): a pause/stop restricts the agent, a resume lifts it. Awaited so the UI reflects it on the next read; never fails the control action.
  try {
    await evaluateTrust(organizationId, agent.id, { trigger: "OPERATOR_CONTROL", triggerRef: `${agent.status}>${status}` });
  } catch (error) {
    console.error(JSON.stringify({ msg: "trust_evaluation_failed", agentId: agent.id, error: String(error) }));
  }

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
