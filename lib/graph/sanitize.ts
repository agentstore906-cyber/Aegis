/**
 * Display-safe context for the action graph.
 *
 * The graph shows what an agent OBSERVABLY did and the context it reported —
 * never its reasoning. Aegis does not ask for reasoning, but callers send free-
 * form `metadata`/`context`, and some put thoughts, scratchpads or chain-of-
 * thought in it. This strips fields that are NAMED like reasoning content
 * before anything is displayed or returned by the API. It is a best-effort
 * guard by field name, not a content classifier: it cannot recognize reasoning
 * hidden under an innocent key, which is why the docs say "Aegis does not
 * collect reasoning" and tell integrators not to send it.
 */

export const WITHHELD = "[withheld: reasoning content]";

const MAX_STRING = 500;
const MAX_KEYS = 40;
const MAX_ARRAY = 20;
const MAX_DEPTH = 5;

/** Whole-token matches after splitting camelCase / snake_case / kebab-case. */
const REASONING_TOKENS = new Set(["thought", "thoughts", "thinking", "scratchpad", "monologue", "rationale", "cot", "reasoning", "reflection", "reflections"]);

function tokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True for keys like `reasoning`, `chain_of_thought`, `internalMonologue`, `agent_thoughts`; false for `failure_reason`, `reasonCode`. */
export function isReasoningKey(key: string): boolean {
  const parts = tokens(key);
  if (parts.some((p) => REASONING_TOKENS.has(p))) return true;
  const joined = parts.join(" ");
  return joined.includes("chain of thought") || joined.includes("train of thought");
}

function truncate(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export type Sanitized = { value: unknown; withheld: boolean };

export function sanitizeContext(input: unknown): Sanitized {
  let withheld = false;

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return truncate(value);
    if (depth >= MAX_DEPTH) return "[truncated]";
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((v) => walk(v, depth + 1));
      if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more]`);
      return items;
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (count >= MAX_KEYS) {
          out["[more]"] = `${Object.keys(value as object).length - MAX_KEYS} more keys`;
          break;
        }
        count += 1;
        if (isReasoningKey(key)) {
          withheld = true;
          out[key] = WITHHELD;
        } else {
          out[key] = walk(v, depth + 1);
        }
      }
      return out;
    }
    return String(value);
  };

  const value = input === null || input === undefined ? null : walk(input, 0);
  return { value, withheld };
}

/** Caller-supplied one-line summaries are shown, but bounded. */
export function shortText(value: string | null, max = 300): string | null {
  return value === null ? null : truncate(value, max);
}
