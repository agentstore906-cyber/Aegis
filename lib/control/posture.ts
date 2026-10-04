import type { AgentStatus, Environment, RiskLevel, TrustState } from "@prisma/client";

import type { IdentityAssurance } from "@/lib/control/identity";

/**
 * Derived control posture, adoption stage and attention flags — computed from
 * evidence, NEVER stored.
 *
 * Why derived: the stored lifecycle (Agent.status: ACTIVE / PAUSED / STOPPED /
 * NEEDS_ATTENTION / ARCHIVED) is what an operator chose. Conditions like "never
 * configured", "reports activity but never asks for a decision", or "trust has
 * degraded" are FACTS ABOUT THE DATA; storing them as states would create a
 * second source of truth that can disagree with it. So they are computed on
 * read, from rows, by these pure functions
 * (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §5).
 */

export type AgentPosture =
  /** ARCHIVED. */
  | "RETIRED"
  /** Operator kill switch — Aegis refuses its authorization requests. */
  | "STOPPED"
  | "PAUSED"
  | "NEEDS_ATTENTION"
  /** Active, but nothing has been granted: Aegis default-denies everything it asks for. */
  | "DISCOVERED"
  /** Active and configured, with no activity in the window. */
  | "QUIET"
  /** Reports activity but never asks for a decision: Aegis is observing, not in the loop. */
  | "OBSERVED"
  /** Asks for decisions: Aegis is in the loop (how far is shown by enforcement coverage). */
  | "PROTECTED";

export type AdoptionStage = "CONNECTED" | "OBSERVING" | "PROTECTED";

export type PostureInput = {
  status: AgentStatus;
  permissionCount: number;
  /** Events of any kind in the window. */
  activityEvents: number;
  /** /evaluate decisions requested in the window. */
  decisionRequests: number;
};

export function derivePosture(i: PostureInput): AgentPosture {
  switch (i.status) {
    case "ARCHIVED":
      return "RETIRED";
    case "STOPPED":
      return "STOPPED";
    case "PAUSED":
      return "PAUSED";
    case "NEEDS_ATTENTION":
      return "NEEDS_ATTENTION";
    case "ACTIVE":
      if (i.permissionCount === 0) return "DISCOVERED";
      if (i.decisionRequests > 0) return "PROTECTED";
      if (i.activityEvents > 0) return "OBSERVED";
      return "QUIET";
  }
}

/** The CONNECT → OBSERVE → PROTECT journey, measured from data. (ENFORCE is shown as coverage, not claimed as a label.) */
export function adoptionStage(i: Pick<PostureInput, "activityEvents" | "decisionRequests">): AdoptionStage {
  if (i.decisionRequests > 0) return "PROTECTED";
  if (i.activityEvents > 0) return "OBSERVING";
  return "CONNECTED";
}

export type AttentionFlag =
  | "HIGH_RISK"
  | "TRUST_DEGRADED"
  | "UNUSUAL_BEHAVIOR"
  | "OPEN_INCIDENT"
  | "PENDING_APPROVAL"
  | "BROAD_GRANT"
  | "SHARED_IDENTITY"
  | "RAN_DESPITE_DECISION"
  | "NO_OWNER";

export const ATTENTION_FLAG_LABEL: Record<AttentionFlag, string> = {
  HIGH_RISK: "High risk",
  TRUST_DEGRADED: "Trust degraded",
  UNUSUAL_BEHAVIOR: "Unusual behavior",
  OPEN_INCIDENT: "Open incident",
  PENDING_APPROVAL: "Needs approval",
  BROAD_GRANT: "Broad grant",
  SHARED_IDENTITY: "Shared-key identity",
  RAN_DESPITE_DECISION: "Ran despite a decision",
  NO_OWNER: "No owner",
};

/** Owners that mean "nobody was assigned": self-registered agents get "API". */
const UNASSIGNED_OWNERS = new Set(["", "api", "unknown", "unassigned", "none", "n/a"]);
export const isUnowned = (owner: string) => UNASSIGNED_OWNERS.has(owner.trim().toLowerCase());

export type AttentionInput = {
  configuredRiskLevel: RiskLevel;
  trustState: TrustState | null;
  deviations7d: number;
  openIncidents: number;
  pendingApprovals: number;
  /** ALLOW permissions over a whole action namespace ("crm.*") for any resource. */
  broadGrants: number;
  identityAssurance: IdentityAssurance;
  /** Events reported in the window (an agent that never calls the API has no shared-key exposure to speak of). */
  activityEvents: number;
  ranDespite: number;
  owner: string;
};

export function attentionFlags(i: AttentionInput): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (i.configuredRiskLevel === "HIGH" || i.configuredRiskLevel === "CRITICAL" || i.trustState === "HIGH_RISK" || i.trustState === "RESTRICTED") flags.push("HIGH_RISK");
  if (i.trustState === "DEGRADED" || i.trustState === "HIGH_RISK" || i.trustState === "RESTRICTED") flags.push("TRUST_DEGRADED");
  if (i.deviations7d > 0) flags.push("UNUSUAL_BEHAVIOR");
  if (i.openIncidents > 0) flags.push("OPEN_INCIDENT");
  if (i.pendingApprovals > 0) flags.push("PENDING_APPROVAL");
  if (i.broadGrants > 0) flags.push("BROAD_GRANT");
  if (i.identityAssurance === "ORG_WIDE_ONLY" && i.activityEvents > 0) flags.push("SHARED_IDENTITY");
  if (i.ranDespite > 0) flags.push("RAN_DESPITE_DECISION");
  if (isUnowned(i.owner)) flags.push("NO_OWNER");
  return flags;
}

export type EnvironmentName = Environment;
