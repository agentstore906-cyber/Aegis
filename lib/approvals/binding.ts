import { createHash } from "node:crypto";

/**
 * Approval lifetime (P0). Plain constants rather than per-org settings for
 * now — see docs/AEGIS_P0_IMPLEMENTATION.md "product decisions".
 *
 *   PENDING_TTL    how long a human has to decide before the request
 *                  becomes EXPIRED (and can never be approved).
 *   EXECUTION_TTL  once APPROVED, how long the agent has to use (consume)
 *                  the approval for its one execution.
 */
export const APPROVAL_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const APPROVAL_EXECUTION_TTL_MS = 60 * 60 * 1000;

export type FingerprintInput = {
  agentId: string;
  action: string;
  resource?: string | null;
  environment?: string | null;
  tool?: string | null;
  context?: unknown;
  /**
   * P1 telemetry that is part of *what* was approved (destination, data
   * classes, volume, end user, service). Included only when present, so a
   * request without telemetry fingerprints exactly as before — and a request
   * approved for 10 records to one destination can't be executed for 10,000
   * records or another destination.
   */
  telemetry?: Record<string, unknown>;
};

/** Deterministic JSON: object keys sorted at every depth, so `{a,b}` and `{b,a}` fingerprint identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * The identity of "the request a human approved." An approval can only be
 * consumed by an evaluation with the same fingerprint — same agent, action,
 * resource, effective environment, tool, and (redacted) context — so one
 * approval can never authorize a different action, a different record, or a
 * different amount. Missing fields normalize to null so "omitted" and
 * "explicitly null" can't produce two different identities.
 */
export function computeRequestFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify(
    canonicalize({
      v: 1,
      agentId: input.agentId,
      action: input.action,
      resource: input.resource ?? null,
      environment: input.environment ?? null,
      tool: input.tool ?? null,
      context: input.context ?? null,
      ...telemetryForFingerprint(input.telemetry),
    })
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function telemetryForFingerprint(telemetry: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!telemetry) return {};
  const present = Object.entries(telemetry).filter(
    ([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)
  );
  return present.length > 0 ? { telemetry: Object.fromEntries(present) } : {};
}

export type ApprovalForConsumption = {
  id: string;
  agentId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  expiresAt: Date | null;
  requestFingerprint: string | null;
  executionExpiresAt: Date | null;
  consumedAt: Date | null;
};

export type ConsumptionCheck =
  | { ok: true }
  | { ok: false; outcome: "PENDING" }
  | { ok: false; outcome: "DENY"; code: ApprovalDenialCode; reason: string };

export type ApprovalDenialCode =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_AGENT_MISMATCH"
  | "APPROVAL_REQUEST_MISMATCH"
  | "APPROVAL_LEGACY_UNBOUND"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_CANCELLED"
  | "APPROVAL_ALREADY_USED"
  | "APPROVAL_EXECUTION_WINDOW_EXPIRED";

/**
 * Pure pre-check of whether an approval may be consumed by a request with
 * `fingerprint` from `agentId`. The authoritative, race-safe claim is the
 * conditional UPDATE in lib/policies/evaluate.ts — this only produces the
 * specific, explainable reason when it can't.
 */
export function checkApprovalConsumable(
  approval: ApprovalForConsumption | null,
  agentId: string,
  fingerprint: string,
  now: Date
): ConsumptionCheck {
  const deny = (code: ApprovalDenialCode, reason: string): ConsumptionCheck => ({ ok: false, outcome: "DENY", code, reason });

  if (!approval) return deny("APPROVAL_NOT_FOUND", "the referenced approval request was not found in this organization");
  if (approval.agentId !== agentId) {
    return deny("APPROVAL_AGENT_MISMATCH", "the referenced approval belongs to a different agent");
  }
  // Fingerprint before status: a pending approval for a *different* request
  // must never be reported as "still pending" for this one.
  if (approval.requestFingerprint === null) {
    return deny(
      "APPROVAL_LEGACY_UNBOUND",
      "the referenced approval was created before single-use execution binding existed and cannot authorize an execution — request a new approval"
    );
  }
  if (approval.requestFingerprint !== fingerprint) {
    return deny(
      "APPROVAL_REQUEST_MISMATCH",
      "the referenced approval was granted for a different request (action, resource, environment, tool, or context differ)"
    );
  }

  switch (approval.status) {
    case "PENDING":
      if (approval.expiresAt && approval.expiresAt <= now) {
        return deny("APPROVAL_EXPIRED", "the referenced approval request expired before a human decided it");
      }
      return { ok: false, outcome: "PENDING" };
    case "REJECTED":
      return deny("APPROVAL_REJECTED", "the referenced approval request was rejected by a human");
    case "EXPIRED":
      return deny("APPROVAL_EXPIRED", "the referenced approval request expired before a human decided it");
    case "CANCELLED":
      return deny("APPROVAL_CANCELLED", "the referenced approval request was cancelled");
    case "APPROVED":
      break;
  }

  if (approval.consumedAt) {
    return deny("APPROVAL_ALREADY_USED", "the referenced approval has already been used for an execution and is single-use");
  }
  if (!approval.executionExpiresAt || approval.executionExpiresAt <= now) {
    return deny("APPROVAL_EXECUTION_WINDOW_EXPIRED", "the referenced approval's execution window has expired");
  }
  return { ok: true };
}
