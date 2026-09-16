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

function collectSecretShapedKeyPaths(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectSecretShapedKeyPaths(item, `${path}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const keyPath = path ? `${path}.${key}` : key;
      if (SECRET_KEY_PATTERN.test(key)) {
        out.push(keyPath);
      } else {
        collectSecretShapedKeyPaths(v, keyPath, out);
      }
    }
  }
}

/**
 * Reports *which* key paths look secret-shaped, without ever returning the
 * value itself — used to raise a CREDENTIAL_EXPOSURE_DETECTED finding
 * (lib/security/detectors.ts#detectCredentialExposureIndicator) when an
 * agent's self-reported event metadata contains a field that shouldn't
 * have been sent to Aegis in the first place. The value is still masked by
 * redactSecrets() before anything is persisted — this only names the field.
 */
export function findSecretShapedKeyPaths(value: unknown): string[] {
  const out: string[] = [];
  collectSecretShapedKeyPaths(value, "", out);
  return out;
}
