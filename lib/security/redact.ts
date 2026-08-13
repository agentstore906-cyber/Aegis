/**
 * Reusable secret-redaction utility (spec §39). Security evidence, audit
 * metadata, and webhook payloads may echo caller-supplied context —
 * masking likely-secret keys here means Aegis never relies on callers to
 * avoid sending them in the first place.
 *
 * Deliberately key-based, not value-based: trying to pattern-match secret
 * *values* (JWTs, API keys, etc.) is unreliable and gives false
 * confidence. Matching well-known key names is simpler and catches the
 * overwhelming majority of real cases.
 */
const SECRET_KEY_PATTERN = /(auth|token|api[-_]?key|password|secret|cookie)/i;

const REDACTED = "[REDACTED]";

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(v);
    }
    return result;
  }

  return value;
}

/** Walks a JSON-like value, masking any object key that looks like a secret field. */
export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}
