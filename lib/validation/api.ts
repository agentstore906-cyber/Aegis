import { z } from "zod";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";
import { actionSchema } from "@/lib/validation/policy";
import { parseSafeJsonContext } from "@/lib/policies/safe-context";

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

export const API_EVENT_STATUSES = ["SUCCESS", "FAILURE"] as const;

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

export const eventIngestSchema = z.object({
  agent: agentSlugSchema,
  eventType: z.enum(API_EVENT_TYPES),
  action: actionSchema,
  resource: z.string().trim().max(120).optional(),
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
});

export type EventIngestInput = z.infer<typeof eventIngestSchema>;

export const evaluateRequestSchema = z.object({
  agent: agentSlugSchema,
  action: actionSchema,
  resource: z.string().trim().max(120).optional(),
  environment: environmentSchema(),
  tool: z.string().trim().max(60).optional(),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional(),
  context: safeJsonObjectSchema(),
  traceId: traceIdSchema,
});

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
