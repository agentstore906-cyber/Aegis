import { z } from "zod";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";

export const POLICY_DECISIONS = ["ALLOW", "REQUIRE_APPROVAL", "BLOCK"] as const;
export const POLICY_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const CONDITION_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "IN",
  "NOT_IN",
  "EXISTS",
] as const;

const NUMERIC_OPERATORS = new Set([
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
]);
const LIST_OPERATORS = new Set(["IN", "NOT_IN"]);

/** Action codes: lowercase dot-namespaced, optionally ending in a ".*" wildcard segment. */
export const ACTION_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$/;

/** Whitelisted condition field paths — must mirror lib/policies/conditions.ts's resolver. */
const FIELD_PATTERN =
  /^(context\.[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+){0,4}|action|resource|environment|tool|riskLevel|agentId)$/;

export const actionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Action is required")
  .max(80)
  .regex(ACTION_PATTERN, 'Use lowercase dot-namespaced actions, e.g. "refund.issue" or "crm.*"');

export const conditionSchema = z
  .object({
    field: z
      .string()
      .trim()
      .min(1, "Field is required")
      .max(100)
      .regex(FIELD_PATTERN, 'Use "context.<name>" or one of action/resource/environment/tool/riskLevel'),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  })
  .superRefine((condition, ctx) => {
    if (NUMERIC_OPERATORS.has(condition.operator)) {
      const numeric =
        typeof condition.value === "number" ? condition.value : Number(condition.value);
      if (typeof condition.value === "boolean" || Array.isArray(condition.value) || Number.isNaN(numeric)) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: `${condition.operator} requires a numeric value`,
        });
      }
    }
    if (LIST_OPERATORS.has(condition.operator) && !Array.isArray(condition.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `${condition.operator} requires a list of values`,
      });
    }
    if (condition.operator === "EXISTS" && condition.value !== true) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "EXISTS does not take a value" });
    }
  })
  .transform((condition) => ({
    ...condition,
    value: NUMERIC_OPERATORS.has(condition.operator)
      ? Number(condition.value)
      : condition.value,
  }));

export type ConditionInput = z.infer<typeof conditionSchema>;

export const policySchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  status: z.enum(POLICY_STATUSES),
  priority: z.coerce.number().int().min(0).max(1000),
  decision: z.enum(POLICY_DECISIONS),
  agentId: z.string().trim().max(60).optional().or(z.literal("")),
  action: actionSchema,
  resource: z.string().trim().max(80).optional().or(z.literal("")),
  environment: z.enum(AGENT_ENVIRONMENTS).optional().or(z.literal("")),
  tool: z.string().trim().max(60).optional().or(z.literal("")),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional().or(z.literal("")),
  conditions: z.array(conditionSchema).max(10, "A policy can have at most 10 conditions"),
});

export type PolicyFormInput = z.infer<typeof policySchema>;

export const policyFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
  decision: z.enum(POLICY_DECISIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type PolicyFiltersInput = z.infer<typeof policyFiltersSchema>;

export const evaluationFiltersSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  decision: z.enum(POLICY_DECISIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type EvaluationFiltersInput = z.infer<typeof evaluationFiltersSchema>;
