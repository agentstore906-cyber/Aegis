import type { ActivityType, RiskLevel } from "@prisma/client";

/**
 * Deterministic, rule-based risk scoring for a directly-reported activity
 * event (POST /api/v1/events — see lib/activity/ingest.ts). Deliberately
 * not an ML/LLM classifier: every score traces back to one named rule, so
 * "why is this MEDIUM?" always has a one-sentence answer.
 *
 * This is distinct from — and does not replace — the policy engine
 * (lib/policies/evaluate.ts), which decides ALLOW/REQUIRE_APPROVAL/BLOCK
 * from configured permissions and policies. This scorer only classifies
 * the *risk level* of an event Aegis is told already happened; it has no
 * say over whether an action is permitted.
 *
 * Rules are ordered, first match wins, and are plain data — extending the
 * rule set later (spec: "make the rule engine extensible") means adding an
 * entry to RULES, not touching the evaluation loop.
 */

type ScoreInput = {
  eventType: ActivityType;
  action: string;
  resource?: string | null;
  status: "SUCCESS" | "FAILURE" | "BLOCKED" | "WARNING";
};

type Rule = {
  name: string;
  level: RiskLevel;
  test: (input: ScoreInput, haystack: string) => boolean;
};

// Exported as keyword arrays (not just the derived regex) so
// lib/security/risk-score.ts (and formerly lib/security/baseline.ts) can build a
// Prisma `OR: [{ action: { contains: keyword } }, ...]` filter from the
// exact same vocabulary used here — one definition of "sensitive" /
// "destructive," never a second regex drifting out of sync with a second
// keyword list.
export const SENSITIVE_RESOURCE_KEYWORDS = [
  "customer",
  "user",
  "account",
  "contact",
  "patient",
  "employee",
  "billing",
  "payment",
  "card",
  "ssn",
  "pii",
];
export const DELETE_KEYWORDS = ["delete", "remove", "purge", "erase", "destroy"];

export const SENSITIVE_RESOURCE_PATTERN = new RegExp(`(${SENSITIVE_RESOURCE_KEYWORDS.join("|")})`);
export const DELETE_PATTERN = new RegExp(`(${DELETE_KEYWORDS.join("|")})`);
const CRITICAL_EXPORT_PATTERN = /(export|dump|download|extract)/;
const WRITE_PATTERN = /(write|update|modify|edit|create|insert|send|issue|refund|transfer|deploy|execute)/;
const READ_PATTERN = /(read|get|list|view|fetch|search|query|lookup)/;
const PUBLIC_RESOURCE_PATTERN = /(public|docs|marketing|blog|status_page)/;

/**
 * Rule order encodes precedence: an unauthorized/blocked attempt always
 * outranks the action's own baseline risk, then destructive/exfiltration
 * actions on sensitive data, then general write vs. read, then a public-data
 * floor. Nothing here mutates `resource`/`action` — matching is
 * case-insensitive against a single lowercased haystack built once.
 */
const RULES: Rule[] = [
  {
    // An action Aegis was told was blocked or failed is inherently worth
    // more attention than the same action succeeding would have been.
    name: "unauthorized_attempt",
    level: "HIGH",
    test: (input) => input.status === "BLOCKED",
  },
  {
    name: "export_sensitive_data",
    level: "CRITICAL",
    test: (_input, haystack) => CRITICAL_EXPORT_PATTERN.test(haystack) && SENSITIVE_RESOURCE_PATTERN.test(haystack),
  },
  {
    name: "delete_data",
    level: "HIGH",
    test: (_input, haystack) => DELETE_PATTERN.test(haystack),
  },
  {
    name: "modify_sensitive_data",
    level: "HIGH",
    test: (_input, haystack) => WRITE_PATTERN.test(haystack) && SENSITIVE_RESOURCE_PATTERN.test(haystack),
  },
  {
    name: "financial_action",
    level: "HIGH",
    test: (input) => input.eventType === "FINANCIAL",
  },
  {
    name: "read_sensitive_data",
    level: "MEDIUM",
    test: (_input, haystack) => READ_PATTERN.test(haystack) && SENSITIVE_RESOURCE_PATTERN.test(haystack),
  },
  {
    name: "general_write",
    level: "MEDIUM",
    test: (_input, haystack) => WRITE_PATTERN.test(haystack),
  },
  {
    name: "read_public_data",
    level: "LOW",
    test: (_input, haystack) => READ_PATTERN.test(haystack) && PUBLIC_RESOURCE_PATTERN.test(haystack),
  },
];

const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Scores one reported event. `status === "FAILURE"` never raises risk on
 * its own (a failed low-risk read is still low-risk) — only BLOCKED does,
 * since that means something already judged the action worth stopping.
 */
export function scoreEventRisk(input: ScoreInput): { level: RiskLevel; rule: string | null } {
  const haystack = `${input.action} ${input.resource ?? ""}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.test(input, haystack)) {
      return { level: rule.level, rule: rule.name };
    }
  }

  return { level: "LOW", rule: null };
}

/** Highest of two risk levels — used where a caller-supplied floor (e.g. the agent's own configured risk level) should never be scored down. */
export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}
