import type { ConditionOperator } from "@prisma/client";
import type { JsonPrimitive, PolicyEvaluationInput } from "@/lib/policies/types";

/**
 * Condition evaluation is data-driven, never code-driven: no `eval`, no
 * `Function()`, no user-supplied expressions. A condition's `field` is
 * resolved through this fixed whitelist of paths, and comparisons only
 * ever run against the resulting primitive value.
 */

const TOP_LEVEL_FIELDS = new Set(["action", "resource", "environment", "tool", "riskLevel", "agentId"]);

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Resolves a whitelisted field path (e.g. "context.amount", "environment") against the evaluation input. */
export function resolveField(field: string, input: PolicyEvaluationInput): JsonPrimitive | undefined {
  const segments = field.split(".").filter(Boolean);
  if (segments.length === 0) return undefined;

  const [root, ...rest] = segments;

  if (root === "context") {
    if (rest.length === 0 || rest.length > 5) return undefined;
    let cursor: unknown = input.context ?? {};
    for (const key of rest) {
      if (UNSAFE_KEYS.has(key)) return undefined;
      if (cursor === null || typeof cursor !== "object") return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return isJsonPrimitive(cursor) ? cursor : undefined;
  }

  if (rest.length > 0) return undefined; // top-level fields are not nested
  if (!TOP_LEVEL_FIELDS.has(root)) return undefined;

  const value = (input as unknown as Record<string, unknown>)[root];
  return isJsonPrimitive(value) ? value : undefined;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function toComparableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Evaluates one operator against a resolved field value and a condition's
 * configured value. Returns false (never throws) for missing fields or
 * type-incompatible comparisons — an unmatched condition just means the
 * policy it belongs to doesn't apply, which is always the safe outcome.
 */
export function evaluateOperator(
  operator: ConditionOperator,
  resolved: JsonPrimitive | undefined,
  conditionValue: unknown
): boolean {
  switch (operator) {
    case "EXISTS":
      return resolved !== undefined && resolved !== null;

    case "EQUALS":
      if (resolved === undefined) return false;
      return String(resolved) === String(conditionValue);

    case "NOT_EQUALS":
      if (resolved === undefined) return false;
      return String(resolved) !== String(conditionValue);

    case "GREATER_THAN":
    case "GREATER_THAN_OR_EQUAL":
    case "LESS_THAN":
    case "LESS_THAN_OR_EQUAL": {
      const left = toComparableNumber(resolved);
      const right = toComparableNumber(conditionValue);
      if (left === null || right === null) return false;
      if (operator === "GREATER_THAN") return left > right;
      if (operator === "GREATER_THAN_OR_EQUAL") return left >= right;
      if (operator === "LESS_THAN") return left < right;
      return left <= right;
    }

    case "IN":
    case "NOT_IN": {
      if (resolved === undefined) return false;
      if (!Array.isArray(conditionValue)) return false;
      const isMember = conditionValue.some((v) => String(v) === String(resolved));
      return operator === "IN" ? isMember : !isMember;
    }

    default:
      return false;
  }
}
