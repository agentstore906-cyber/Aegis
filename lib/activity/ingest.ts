import "server-only";

import type { Agent } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { EventIngestInput } from "@/lib/validation/api";
import { runSecurityDetectors } from "@/lib/security/evaluate";
import { redactSecrets } from "@/lib/security/redact";
import { trackEvent } from "@/lib/analytics/track";

const EXTERNAL_STATUS_TO_ACTIVITY_STATUS = { SUCCESS: "ALLOWED", FAILURE: "FAILED" } as const;

/**
 * Records an activity event reported directly by an external agent via
 * POST /api/v1/events — this is "here's what I already did," distinct
 * from evaluateAgentAction() ("may I do this"), which creates its own
 * ActivityEvent as part of a decision. A thin sibling of that inline
 * creation, not a duplicate of its logic.
 */
export async function ingestActivityEvent(organizationId: string, agent: Agent, input: EventIngestInput) {
  const status = EXTERNAL_STATUS_TO_ACTIVITY_STATUS[input.status];

  const event = await prisma.activityEvent.create({
    data: {
      organizationId,
      agentId: agent.id,
      eventType: input.eventType,
      action: input.action,
      resource: input.resource,
      status,
      riskLevel: agent.riskLevel,
      durationMs: input.durationMs,
      modelProvider: input.provider,
      modelName: input.model,
      costCents: input.cost !== undefined ? Math.round(input.cost * 100) : undefined,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      taskId: input.taskId,
      taskType: input.taskType,
      traceId: input.traceId,
      metadata: input.metadata ? redactSecrets(input.metadata) : input.metadata,
    },
  });

  await runSecurityDetectors({
    organizationId,
    agent: { id: agent.id, name: agent.name },
    action: input.action,
    riskLevel: agent.riskLevel,
    status,
    traceId: event.traceId,
  });

  // Cheap, accurate activation signal: only fires the first time this
  // agent's ever had an event ingested, not on every event.
  const priorEventCount = await prisma.activityEvent.count({ where: { agentId: agent.id } });
  if (priorEventCount === 1) {
    trackEvent("first_event_received", { organizationId, agentId: agent.id });
  }

  return event;
}
