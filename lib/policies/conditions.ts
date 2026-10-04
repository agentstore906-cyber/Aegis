import type { ConditionOperator } from "@prisma/client";
import type { JsonPrimitive, PolicyEvaluationInput } from "@/lib/policies/types";
import { sensitivityForDataClasses } from "@/lib/telemetry/normalize";

/**
 * Condition evaluation is data-driven, never code-driven: no `eval`, no
 * `Function()`, no user-supplied expressions. A condition's `field` is
 * resolved through this fixed whitelist of paths, and comparisons only
 * ever run against the resulting primitive value.
 */

const TOP_LEVEL_FIELDS = new Set(["action", "resource", "environment", "tool", "riskLevel", "agentId"]);

/**
 * Agent-reported request telemetry (P1) that policies may now reference — the
 * least-privilege levers for WHERE an agent sends data and WHAT data it touches:
 *
 *   destination        host the action reaches (normalized, host-only)
 *   service            the service/API the action calls
 *   dataSensitivity    LOW | MEDIUM | HIGH | CRITICAL — derived from the data classes
 *                      (never lowered by the caller's own declaration)
 *   recordCount        records touched
 *   byteCount          bytes touched
 *   data.<CLASS>       true/false per data class: data.PII, data.CREDENTIALS, …
 *
 * UNREPORTED IS NOT "NONE": a field the request did not report resolves to
 * undefined, which under STRICT matching is INDETERMINATE — it matches
 * restrictive policies and not ALLOW (see matcher.ts), so an agent cannot dodge
 * a destination allow-list or a data policy by omitting the field.
 *
 * These are AGENT-REPORTED. Unlike environment and riskLevel (server-side,
 * trusted), a policy on them is exactly as strong as the integration's honesty
 * until something observes the destination itself (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §2.2, §4).
 */
const DATA_CLASS_NAMES = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "FINANCIAL", "HEALTH", "CREDENTIALS"]);

function resolveTelemetryField(root: string, rest: string[], input: PolicyEvaluationInput): JsonPrimitive | undefined {
  const t = input.telemetry;
  if (!t) return undefined;
  if (root === "data") {
    if (rest.length !== 1 || !DATA_CLASS_NAMES.has(rest[0]) || t.dataClasses === undefined) return undefined;
    return t.dataClasses.includes(rest[0] as never);
  }
  if (rest.length > 0) return undefined;
  switch (root) {
    case "destination":
      return t.destination?.destination;
    case "service":
      return t.service;
    case "recordCount":
      return t.recordCount;
    case "byteCount":
      return t.byteCount;
    case "dataSensitivity":
      return t.dataClasses === undefined && t.dataSensitivity === undefined
        ? undefined
        : (sensitivityForDataClasses(t.dataClasses ?? [], t.dataSensitivity) ?? undefined);
    default:
      return undefined;
  }
}

const TELEMETRY_ROOTS = new Set(["destination", "service", "recordCount", "byteCount", "dataSensitivity", "data"]);

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

  if (TELEMETRY_ROOTS.has(root)) return resolveTelemetryField(root, rest, input);

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

/**
 * Three-valued condition result used by STRICT matching (P0 — see
 * docs/policy-engine.md "Missing and unusable fields"):
 *   true / false  the condition was actually evaluated
 *   null          INDETERMINATE — the field is missing/null, or its value
 *                 can't be compared (e.g. `amount: "lots"` against
 *                 GREATER_THAN 1000), or the configured value is unusable
 *
 * The matcher, not this function, decides what an indeterminate result
 * means: it counts as a MATCH for restrictive policies (BLOCK,
 * REQUIRE_APPROVAL, ALERT) and a NON-match for ALLOW. That's what stops a
 * caller from slipping past "BLOCK refunds where amount > 1000" by leaving
 * `amount` out or sending a non-number. EXISTS is the one operator that is
 * never indeterminate — presence is exactly what it tests.
 */
export function evaluateConditionStrict(
  operator: ConditionOperator,
  resolved: JsonPrimitive | undefined,
  conditionValue: unknown
): boolean | null {
  if (operator === "EXISTS") return resolved !== undefined && resolved !== null;
  if (resolved === undefined || resolved === null) return null;

  switch (operator) {
    case "EQUALS":
      return String(resolved) === String(conditionValue);
    case "NOT_EQUALS":
      return String(resolved) !== String(conditionValue);

    case "GREATER_THAN":
    case "GREATER_THAN_OR_EQUAL":
    case "LESS_THAN":
    case "LESS_THAN_OR_EQUAL": {
      const left = toComparableNumber(resolved);
      const right = toComparableNumber(conditionValue);
      if (left === null || right === null) return null;
      if (operator === "GREATER_THAN") return left > right;
      if (operator === "GREATER_THAN_OR_EQUAL") return left >= right;
      if (operator === "LESS_THAN") return left < right;
      return left <= right;
    }

    case "IN":
    case "NOT_IN": {
      if (!Array.isArray(conditionValue)) return null;
      const isMember = conditionValue.some((v) => String(v) === String(resolved));
      return operator === "IN" ? isMember : !isMember;
    }

    default:
      return null;
  }
}
