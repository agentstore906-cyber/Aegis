/**
 * Parses and validates untrusted JSON context (e.g. from the policy tester)
 * before it ever reaches the evaluation engine. Context is treated purely
 * as data: capped in size and depth, checked for prototype-pollution keys,
 * and restricted to JSON primitives. Never executed, never eval'd.
 */

const MAX_JSON_LENGTH = 4000;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type SafeJsonValue = string | number | boolean | null | SafeJsonValue[] | { [key: string]: SafeJsonValue };

export type ParseResult =
  | { ok: true; value: Record<string, SafeJsonValue> }
  | { ok: false; error: string };

function isPlainPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function validateShape(value: unknown, depth: number, keyCount: { n: number }): boolean {
  if (isPlainPrimitive(value)) return true;
  if (depth >= MAX_DEPTH) return false;

  if (Array.isArray(value)) {
    return value.every((item) => validateShape(item, depth + 1, keyCount));
  }

  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) return false;
      keyCount.n += 1;
      if (keyCount.n > MAX_KEYS) return false;
      if (!validateShape((value as Record<string, unknown>)[key], depth + 1, keyCount)) return false;
    }
    return true;
  }

  return false;
}

export function parseSafeJsonContext(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: {} };

  if (trimmed.length > MAX_JSON_LENGTH) {
    return { ok: false, error: `Context is too large (max ${MAX_JSON_LENGTH} characters).` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Context must be valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Context must be a JSON object, e.g. {\"amount\": 500}." };
  }

  if (!validateShape(parsed, 0, { n: 0 })) {
    return {
      ok: false,
      error: "Context contains unsupported values — use only strings, numbers, booleans, and simple nesting.",
    };
  }

  return { ok: true, value: parsed as Record<string, SafeJsonValue> };
}
