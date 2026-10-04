/**
 * Reusable secret-redaction utility (spec §39). Security evidence, audit
 * metadata, and webhook payloads may echo caller-supplied context —
 * masking likely-secret keys here means Aegis never relies on callers to
 * avoid sending them in the first place.
 *
 * Primarily key-based: matching well-known key names catches the
 * overwhelming majority of real cases. P1 adds a second, narrower layer —
 * redactSecretValues() below — for a short list of credential formats that
 * are unambiguous by shape (provider key prefixes, JWTs, PEM private keys,
 * credentials embedded in URLs). That layer is defense in depth, NOT a
 * guarantee: a secret with no recognizable format still gets through if
 * it's sent under an innocuous key. Never describe it as complete.
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

// ---------------------------------------------------------------------------
// Value-based redaction (P1) — high-precision credential formats only.
// Each pattern is anchored on a distinctive, documented prefix/shape so
// false positives (redacting ordinary text) stay rare. Applied to free text
// and string values Aegis stores from agents (event description/metadata,
// evaluation context). Never applied to `action`/`resource` (identifiers
// used for policy matching).
// ---------------------------------------------------------------------------

const SECRET_VALUE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: "aegis_api_key", pattern: /\baegis_(?:live|test)_[A-Za-z0-9_-]{20,}/g },
  { name: "openai_or_anthropic_key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "stripe_key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: "github_token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: "aws_access_key_id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
];
// scheme://user:password@host — keep the scheme and host, drop the credentials.
const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export type ValueRedactionResult<T> = { value: T; redactedCount: number; kinds: string[] };

function redactText(text: string, kinds: Set<string>): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      kinds.add(name);
      return REDACTED;
    });
  }
  out = out.replace(URL_CREDENTIALS_PATTERN, (_match, scheme: string) => {
    count += 1;
    kinds.add("url_credentials");
    return `${scheme}${REDACTED}@`;
  });
  return { text: out, count };
}

/**
 * Replaces recognizable credential *values* anywhere in a string or a
 * JSON-like value (recursively), and reports how many were found and of which
 * kinds — never the values themselves.
 */
export function redactSecretValues<T>(value: T): ValueRedactionResult<T> {
  const kinds = new Set<string>();
  let redactedCount = 0;

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const { text, count } = redactText(v, kinds);
      redactedCount += count;
      return text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, inner]) => [k, walk(inner)]));
    }
    return v;
  };

  return { value: walk(value) as T, redactedCount, kinds: [...kinds].sort() };
}
