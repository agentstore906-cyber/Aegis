import { isIP } from "node:net";

import type { DataClass, DestinationKind, EventOutcome, RiskLevel } from "@prisma/client";

/**
 * P1 — one representation per concept (docs/AEGIS_P1_DATA_FOUNDATION.md
 * "Normalization"). Callers spell things however they like; everything Aegis
 * stores, indexes, and later baselines on goes through these pure functions.
 *
 * Already normalized elsewhere, deliberately not duplicated here:
 *   - action       lowercase dot-namespaced code (lib/validation/policy.ts#actionSchema)
 *   - action type  the ActivityType enum (eventType)
 *   - environment  the Environment enum, case-insensitive input (lib/validation/api.ts)
 */

// ---------------------------------------------------------------------------
// Identifier keys (tools, services)
// ---------------------------------------------------------------------------

export const KEY_MAX_LENGTH = 60;

/**
 * Removes case and spacing noise: "Zendesk API", " zendesk  api", and
 * "ZENDESK-API" all become "zendesk-api". Lowercase; runs of anything outside
 * [a-z0-9._-] become one "-"; leading/trailing "-" trimmed; max 60 chars.
 * "_" and "." are kept, so "zendesk_api" stays distinct from "zendesk-api" —
 * Aegis doesn't guess that two different spellings are the same product.
 * Returns null when nothing meaningful is left.
 *
 * MUST stay identical to the SQL backfill in the P1 migration.
 */
export function normalizeKey(raw: string | null | undefined, maxLength = KEY_MAX_LENGTH): string | null {
  if (raw === null || raw === undefined) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, "");
  return key.length > 0 ? key : null;
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

export type NormalizedDestination = { destination: string; kind: DestinationKind };
export type DestinationResult = { ok: true; value: NormalizedDestination } | { ok: false; error: string };

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/;

function normalizeHostname(raw: string): string | null {
  const host = raw.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    return isIP(inner) === 6 ? inner : null;
  }
  if (isIP(host)) return host;
  return HOSTNAME_PATTERN.test(host) ? host : null;
}

/**
 * Reduces a caller-reported destination to the host (or IP, or an email's
 * domain) it points at. Accepts a URL, a bare host (optionally with path),
 * or an email address. NEVER keeps the path, query string, fragment,
 * userinfo, port, or an email's local part — those routinely carry tokens,
 * record ids, or personal data, and the host is what behavioral analysis
 * needs ("first time this agent sent data to files.example-share.io").
 * Internationalized hosts are stored in their punycode (ASCII) form.
 */
export function normalizeDestination(raw: string): DestinationResult {
  const input = raw.trim();
  if (input.length === 0) return { ok: false, error: "`destination` must not be empty." };

  const email = EMAIL_PATTERN.exec(input);
  if (email && !input.includes("://") && !input.includes("/")) {
    const domain = safeUrlHostname(`https://${email[1]}`);
    const host = domain ? normalizeHostname(domain) : null;
    if (!host || isIP(host)) return { ok: false, error: "`destination` email address has an invalid domain." };
    return { ok: true, value: { destination: host, kind: "EMAIL_DOMAIN" } };
  }

  // Without a scheme, an "@" must form a valid email address (handled above) —
  // never let "@host" or "junk@" slip through URL parsing as userinfo.
  if (!input.includes("://") && input.includes("@")) {
    return { ok: false, error: "`destination` must be a URL, a hostname, or an email address." };
  }

  const hostname = safeUrlHostname(input.includes("://") ? input : `https://${input}`);
  const host = hostname ? normalizeHostname(hostname) : null;
  if (!host) {
    return { ok: false, error: "`destination` must be a URL, a hostname, or an email address." };
  }
  return { ok: true, value: { destination: host, kind: isIP(host) ? "IP" : "HOST" } };
}

function safeUrlHostname(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.hostname || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data classes and sensitivity
// ---------------------------------------------------------------------------

export const DATA_CLASSES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "FINANCIAL", "HEALTH", "CREDENTIALS"] as const;
export const MAX_DATA_CLASSES = 7;

/** Case-insensitive, de-duplicated, stable order. Unknown values are an error, not silently dropped. */
export function normalizeDataClasses(raw: string[]): { ok: true; value: DataClass[] } | { ok: false; error: string } {
  const out = new Set<DataClass>();
  for (const item of raw) {
    const upper = item.trim().toUpperCase();
    if (!(DATA_CLASSES as readonly string[]).includes(upper)) {
      return { ok: false, error: `Unknown data class "${item}". Use one of: ${DATA_CLASSES.join(", ")}.` };
    }
    out.add(upper as DataClass);
  }
  return { ok: true, value: DATA_CLASSES.filter((c) => out.has(c)) };
}

/** Fixed, documented mapping — how sensitive each class of data is on its own. */
export const DATA_CLASS_SENSITIVITY: Record<DataClass, RiskLevel> = {
  PUBLIC: "LOW",
  INTERNAL: "MEDIUM",
  CONFIDENTIAL: "HIGH",
  PII: "HIGH",
  FINANCIAL: "HIGH",
  HEALTH: "CRITICAL",
  CREDENTIALS: "CRITICAL",
};

const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Sensitivity of the data an event touched: the highest level implied by its
 * classes, raised (never lowered) by a caller's own declaration. Null when
 * neither classes nor a declaration were reported — unknown, not LOW.
 */
export function sensitivityForDataClasses(classes: DataClass[], declared?: RiskLevel | null): RiskLevel | null {
  let level: RiskLevel | null = declared ?? null;
  for (const dataClass of classes) {
    const implied = DATA_CLASS_SENSITIVITY[dataClass];
    if (level === null || LEVEL_RANK[implied] > LEVEL_RANK[level]) level = implied;
  }
  return level;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** The one mapping from a reported result ("SUCCESS"/...) to the stored EventOutcome. */
export const REPORTED_STATUS_TO_OUTCOME: Record<"SUCCESS" | "FAILURE" | "BLOCKED" | "WARNING", EventOutcome> = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  BLOCKED: "BLOCKED",
  WARNING: "WARNING",
};

// ---------------------------------------------------------------------------
// Client event ids
// ---------------------------------------------------------------------------

export const CLIENT_EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
