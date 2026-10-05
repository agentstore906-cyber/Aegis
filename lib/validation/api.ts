import { z } from "zod";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";
import { actionSchema } from "@/lib/validation/policy";
import { parseSafeJsonContext } from "@/lib/policies/safe-context";
import {
  CLIENT_EVENT_ID_PATTERN,
  MAX_DATA_CLASSES,
  normalizeDataClasses,
  normalizeDestination,
  normalizeKey,
} from "@/lib/telemetry/normalize";

/**
 * Validation for the public API (app/api/v1/*). Deliberately separate
 * from lib/validation/activity.ts and lib/validation/tester.ts, which
 * validate dashboard form input — external callers get their own schemas
 * so the two can evolve independently (e.g. the external event vocabulary
 * below, "SUCCESS"/"FAILURE", is friendlier for an SDK than the internal
 * ActivityStatus enum and is translated in lib/activity/ingest.ts).
 */

export const API_EVENT_TYPES = [
  "TOOL_CALL",
  "MODEL_CALL",
  "DATA_ACCESS",
  "ACTION",
  "DEPLOYMENT",
  "COMMUNICATION",
  "FINANCIAL",
  "SYSTEM",
] as const;

// BLOCKED/WARNING let an agent self-report that its own guardrail stopped
// an action, or that an action succeeded but looked suspicious — distinct
// from SUCCESS/FAILURE, which describe whether the action itself errored.
export const API_EVENT_STATUSES = ["SUCCESS", "FAILURE", "BLOCKED", "WARNING"] as const;

// Optional on the wire: a key bound to one agent already says WHICH agent is calling, so the server derives it
// (lib/api/agent-access.ts). When given, it is only a claim and must match the key.
const agentSlugSchema = z.string().trim().min(1, "`agent` is required").max(80);
const traceIdSchema = z.string().trim().min(1).max(120).optional();

/** Reuses lib/policies/safe-context.ts's size/depth/proto-pollution checks for any inbound JSON object field. */
function safeJsonObjectSchema() {
  return z
    .record(z.string(), z.unknown())
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined;
      const result = parseSafeJsonContext(JSON.stringify(raw));
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return undefined;
      }
      return result.value;
    });
}

const ENVIRONMENT_LOOKUP = new Map(AGENT_ENVIRONMENTS.map((value) => [value.toLowerCase(), value]));

/** Accepts "production"/"PRODUCTION"/"Production" alike — external callers shouldn't have to match our enum's casing. */
function environmentSchema() {
  return z
    .string()
    .trim()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const match = ENVIRONMENT_LOOKUP.get(raw.toLowerCase());
      if (!match) {
        ctx.addIssue({ code: "custom", message: `environment must be one of: ${AGENT_ENVIRONMENTS.join(", ")}` });
        return undefined;
      }
      return match;
    });
}

// ---------------------------------------------------------------------------
// P1 telemetry fields (docs/AEGIS_P1_DATA_FOUNDATION.md). All optional.
// Normalized here, at the boundary, so everything downstream sees exactly one
// representation per concept; anything that can't be normalized is a 400,
// never silently dropped or guessed.
// ---------------------------------------------------------------------------

const OCCURRED_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OCCURRED_AT_MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_BYTE_COUNT = 2_147_483_647; // Postgres INTEGER; documented limit

const clientEventIdSchema = z
  .string()
  .trim()
  .regex(CLIENT_EVENT_ID_PATTERN, "`clientEventId` must be 1-120 characters of letters, digits, `.`, `_`, `:` or `-`.");

const aegisIdSchema = z.string().trim().min(1).max(64);

const serviceSchema = z
  .string()
  .max(80)
  .transform((raw, ctx) => {
    const key = normalizeKey(raw);
    if (!key) {
      ctx.addIssue({ code: "custom", message: "`service` must contain letters or digits." });
      return z.NEVER;
    }
    return key;
  });

const destinationSchema = z
  .string()
  .max(2048)
  .transform((raw, ctx) => {
    const result = normalizeDestination(raw);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.value;
  });

const dataClassesSchema = z
  .array(z.string().max(40))
  .max(MAX_DATA_CLASSES)
  .transform((raw, ctx) => {
    const result = normalizeDataClasses(raw);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.value;
  });

const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "`occurredAt` must be an ISO-8601 timestamp." })
  .transform((raw, ctx) => {
    const date = new Date(raw);
    const now = Date.now();
    if (date.getTime() > now + OCCURRED_AT_MAX_SKEW_MS) {
      ctx.addIssue({ code: "custom", message: "`occurredAt` is in the future." });
      return z.NEVER;
    }
    if (date.getTime() < now - OCCURRED_AT_MAX_AGE_MS) {
      ctx.addIssue({ code: "custom", message: "`occurredAt` is more than 30 days in the past." });
      return z.NEVER;
    }
    return date;
  });

/** Fields shared by /events and /evaluate. The raw `endUserId` is pseudonymized before storage — never persisted. */
const telemetryContextFields = {
  service: serviceSchema.optional(),
  destination: destinationSchema.optional(),
  endUserId: z.string().trim().min(1).max(256).optional(),
  dataClasses: dataClassesSchema.optional(),
  dataSensitivity: z.enum(AGENT_RISK_LEVELS).optional(),
  recordCount: z.number().int().min(0).max(1_000_000_000).optional(),
  byteCount: z.number().int().min(0).max(MAX_BYTE_COUNT).optional(),
  parentEventId: aegisIdSchema.optional(),
  parentClientEventId: clientEventIdSchema.optional(),
};

/** The telemetry a caller may describe an action with — the same normalization the API boundary applies (also used by the policy tester and simulation). */
export const telemetryInputSchema = z.object({
  service: telemetryContextFields.service,
  destination: telemetryContextFields.destination,
  dataClasses: telemetryContextFields.dataClasses,
  dataSensitivity: telemetryContextFields.dataSensitivity,
  recordCount: telemetryContextFields.recordCount,
  byteCount: telemetryContextFields.byteCount,
});

function oneParentReference(value: { parentEventId?: string; parentClientEventId?: string }) {
  return !(value.parentEventId && value.parentClientEventId);
}
const ONE_PARENT_MESSAGE = "Send either `parentEventId` or `parentClientEventId`, not both.";

export const eventIngestSchema = z.object({
  agent: agentSlugSchema.optional(),
  eventType: z.enum(API_EVENT_TYPES),
  action: actionSchema,
  resource: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  tool: z.string().trim().max(60).optional(),
  status: z.enum(API_EVENT_STATUSES).default("SUCCESS"),
  traceId: traceIdSchema,
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  model: z.string().trim().max(60).optional(),
  provider: z.string().trim().max(60).optional(),
  cost: z.number().min(0).max(100_000).optional(),
  // Cost-intelligence detail (Phase 5) — all optional, additive to the
  // Phase 4 payload shape. See docs/cost-intelligence.md.
  inputTokens: z.number().int().min(0).max(50_000_000).optional(),
  outputTokens: z.number().int().min(0).max(50_000_000).optional(),
  taskId: z.string().trim().max(120).optional(),
  taskType: z.string().trim().max(60).optional(),
  metadata: safeJsonObjectSchema(),
  // P1
  clientEventId: clientEventIdSchema.optional(),
  evaluationId: aegisIdSchema.optional(),
  occurredAt: occurredAtSchema.optional(),
  ...telemetryContextFields,
}).refine(oneParentReference, { message: ONE_PARENT_MESSAGE });

export type EventIngestInput = z.infer<typeof eventIngestSchema>;

export const evaluateRequestSchema = z.object({
  agent: agentSlugSchema.optional(),
  action: actionSchema,
  resource: z.string().trim().max(120).optional(),
  environment: environmentSchema(),
  tool: z.string().trim().max(60).optional(),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional(),
  context: safeJsonObjectSchema(),
  traceId: traceIdSchema,
  // An APPROVED approval to consume for this one execution — see
  // lib/approvals/binding.ts. Must be for this exact request.
  approvalRequestId: z.string().trim().min(1).max(64).optional(),
  // P1
  ...telemetryContextFields,
}).refine(oneParentReference, { message: ONE_PARENT_MESSAGE });

export type EvaluateRequestInput = z.infer<typeof evaluateRequestSchema>;

export const agentRegisterSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  owner: z.string().trim().max(80).optional(),
  modelProvider: z.string().trim().max(60).optional(),
  modelName: z.string().trim().max(60).optional(),
  environment: environmentSchema(),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional(),
});

export type AgentRegisterInput = z.infer<typeof agentRegisterSchema>;
