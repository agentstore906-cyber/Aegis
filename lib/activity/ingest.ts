import "server-only";

import { Prisma, type ActivityEvent, type Agent } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { EventIngestInput } from "@/lib/validation/api";
import { runSecurityDetectors } from "@/lib/security/evaluate";
import { findSecretShapedKeyPaths, redactSecretValues, redactSecrets } from "@/lib/security/redact";
import { scoreEventRisk, maxRiskLevel } from "@/lib/security/risk-scoring";
import { trackEvent } from "@/lib/analytics/track";
import { defer } from "@/lib/server/defer";
import { observeEventBehavior } from "@/lib/behavior/observe";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { normalizeKey, REPORTED_STATUS_TO_OUTCOME, sensitivityForDataClasses } from "@/lib/telemetry/normalize";
import { pseudonymizeEndUser } from "@/lib/telemetry/pseudonymize";
import { linkWaitingChildren, resolveLineage } from "@/lib/telemetry/lineage";
import { buildRiskSignals } from "@/lib/telemetry/signals";

const EXTERNAL_STATUS_TO_ACTIVITY_STATUS = {
  SUCCESS: "ALLOWED",
  FAILURE: "FAILED",
  BLOCKED: "BLOCKED",
  WARNING: "WARNING",
} as const;

export class ClientEventIdConflictError extends Error {
  constructor() {
    super("An event with this `clientEventId` was already recorded for this agent with different content.");
    this.name = "ClientEventIdConflictError";
  }
}

export type IngestedEvent = ActivityEvent & {
  /** True when this delivery repeated an already-recorded clientEventId — nothing new was written. */
  duplicate: boolean;
};

export type IngestOptions = {
  /** The authenticated API key's agent binding, if any (P0 §7) — constrains which events may be named as parent. */
  apiKeyAgentId?: string | null;
};

/** The fields that make two deliveries "the same logical event" for clientEventId dedup. */
function sameLogicalEvent(existing: ActivityEvent, input: EventIngestInput): boolean {
  return (
    existing.eventType === input.eventType &&
    existing.action === input.action &&
    (existing.resource ?? null) === (input.resource ?? null) &&
    existing.outcome === REPORTED_STATUS_TO_OUTCOME[input.status]
  );
}

async function findByClientEventId(organizationId: string, agentId: string, clientEventId: string) {
  return prisma.activityEvent.findUnique({
    where: { organizationId_agentId_clientEventId: { organizationId, agentId, clientEventId } },
  });
}

function asDuplicate(existing: ActivityEvent, input: EventIngestInput): IngestedEvent {
  if (!sameLogicalEvent(existing, input)) throw new ClientEventIdConflictError();
  return { ...existing, duplicate: true };
}

/**
 * Records an activity event reported directly by an external agent via
 * POST /api/v1/events — this is "here's what I already did," distinct
 * from evaluateAgentAction() ("may I do this"), which creates its own
 * ActivityEvent as part of a decision.
 *
 * P1 lifecycle (docs/AEGIS_P1_DATA_FOUNDATION.md "Event lifecycle"):
 *   1. validated + normalized at the API boundary (lib/validation/api.ts)
 *   2. dedup by clientEventId — a re-delivered event returns the original
 *   3. lineage resolved (parent / evaluation), tenant- and agent-scoped
 *   4. privacy: key- and value-based secret redaction, end user pseudonymized
 *   5. risk level scored (unchanged rules) + risk signals recorded
 *   6. ONE insert (+ linking any children that arrived first), in a transaction
 *   7. detectors run after the response
 * After step 6 the row is append-only (database trigger).
 */
export async function ingestActivityEvent(
  organizationId: string,
  agent: Agent,
  input: EventIngestInput,
  options: IngestOptions = {}
): Promise<IngestedEvent> {
  if (input.clientEventId) {
    const existing = await findByClientEventId(organizationId, agent.id, input.clientEventId);
    if (existing) return asDuplicate(existing, input);
  }

  const status = EXTERNAL_STATUS_TO_ACTIVITY_STATUS[input.status];
  const outcome = REPORTED_STATUS_TO_OUTCOME[input.status];

  const lineage = await resolveLineage({
    organizationId,
    agentId: agent.id,
    apiKeyAgentId: options.apiKeyAgentId ?? null,
    parentEventId: input.parentEventId,
    parentClientEventId: input.parentClientEventId,
    evaluationId: input.evaluationId,
    traceId: input.traceId,
  });

  // Risk is scored from what actually happened (action/resource/status),
  // not just inherited from the agent's own static classification. The
  // agent's own riskLevel is a floor, never a way to score an event down.
  const scored = scoreEventRisk({
    eventType: input.eventType,
    action: input.action,
    resource: input.resource,
    status: input.status,
  });
  const riskLevel = maxRiskLevel(scored.level, agent.riskLevel);

  // Privacy: key-based redaction (secret-shaped field names), then
  // value-based redaction of recognizable credential formats in free text.
  const secretShapedKeyPaths = input.metadata ? findSecretShapedKeyPaths(input.metadata) : [];
  const metadataRedaction = redactSecretValues(input.metadata ? redactSecrets(input.metadata) : undefined);
  const descriptionRedaction = redactSecretValues(input.description);
  const valueRedactions = {
    count: metadataRedaction.redactedCount + descriptionRedaction.redactedCount,
    kinds: [...new Set([...metadataRedaction.kinds, ...descriptionRedaction.kinds])].sort(),
  };

  const dataClasses = input.dataClasses ?? [];
  const dataSensitivity = sensitivityForDataClasses(dataClasses, input.dataSensitivity);
  const riskSignals = buildRiskSignals({
    scoredRule: scored.rule,
    scoredLevel: scored.level,
    agentRiskLevel: agent.riskLevel,
    dataClasses,
    dataSensitivity,
    secretShapedFieldCount: secretShapedKeyPaths.length,
    secretValueRedactions: valueRedactions,
    evaluationDecision: lineage.evaluationDecision,
    outcome,
  });

  const data = {
    organizationId,
    agentId: agent.id,
    eventType: input.eventType,
    action: input.action,
    resource: input.resource,
    description: descriptionRedaction.value,
    toolName: input.tool,
    toolKey: normalizeKey(input.tool),
    source: "api",
    status,
    outcome,
    riskLevel,
    durationMs: input.durationMs,
    modelProvider: input.provider,
    modelName: input.model,
    costCents: input.cost !== undefined ? Math.round(input.cost * 100) : undefined,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    taskId: input.taskId,
    taskType: input.taskType,
    traceId: lineage.traceId,
    metadata: metadataRedaction.value as Prisma.InputJsonValue | undefined,
    // P1
    clientEventId: input.clientEventId,
    parentEventId: lineage.parentEventId,
    parentClientEventId: lineage.parentClientEventId,
    evaluationId: lineage.evaluationId,
    occurredAt: input.occurredAt,
    environment: agent.environment,
    service: input.service,
    destination: input.destination?.destination,
    destinationKind: input.destination?.kind,
    endUserHash: input.endUserId ? pseudonymizeEndUser(organizationId, input.endUserId) : undefined,
    dataClasses,
    dataSensitivity,
    recordCount: input.recordCount,
    byteCount: input.byteCount,
    riskSignals: riskSignals.length > 0 ? (riskSignals as Prisma.InputJsonValue) : undefined,
  } satisfies Prisma.ActivityEventUncheckedCreateInput;

  let event: ActivityEvent;
  try {
    // Plain single insert on the common path. Only an event that carries a
    // clientEventId can be a late-arriving parent, so only then is a
    // transaction needed to link its waiting children atomically.
    event = input.clientEventId
      ? await prisma.$transaction(async (tx) => {
          const created = await tx.activityEvent.create({ data });
          await linkWaitingChildren(tx, {
            id: created.id,
            organizationId,
            agentId: agent.id,
            clientEventId: input.clientEventId!,
            traceId: created.traceId,
          });
          return created;
        })
      : await prisma.activityEvent.create({ data });
  } catch (error) {
    // Two concurrent deliveries of the same clientEventId: the loser returns the winner's row.
    if (input.clientEventId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findByClientEventId(organizationId, agent.id, input.clientEventId);
      if (existing) return asDuplicate(existing, input);
    }
    throw error;
  }

  // Detection is not part of recording the event — run it after the
  // response (lib/server/defer.ts) so a slow detector query, alert write,
  // or webhook can never delay or fail ingestion. The prompt-injection
  // heuristic sees the description in memory; only the redacted copy is stored.
  // Behavioral memory (P2): compare with this agent's baseline and record
  // deviations — after the response, never part of recording the event.
  defer("behavior:ingest", async () => {
    const deviations = await observeEventBehavior(organizationId, agent.id, event.id);
    // Trust (P3): new deviations are evidence; nothing else about an ordinary event changes trust.
    if (deviations.length > 0) {
      await evaluateTrust(organizationId, agent.id, { trigger: "ACTIVITY_EVENT", triggerRef: event.id });
    }
  });

  defer("security-detectors:ingest", async () => {
    await runSecurityDetectors({
      organizationId,
      agent: { id: agent.id, name: agent.name },
      action: input.action,
      resource: input.resource,
      environment: agent.environment,
      riskLevel,
      status,
      traceId: event.traceId,
      toolName: input.tool,
      description: input.description,
      secretShapedKeyPaths,
      checkPolicyViolation: true,
      agentStatus: agent.status,
    });

    // Cheap, accurate activation signal: only fires the first time this
    // agent's ever had an event ingested, not on every event.
    const priorEventCount = await prisma.activityEvent.count({ where: { agentId: agent.id } });
    if (priorEventCount === 1) {
      trackEvent("first_event_received", { organizationId, agentId: agent.id });
    }
  });

  return { ...event, duplicate: false };
}
