import type {
  AgentStatus,
  BaselineMaturity,
  BehavioralDeviationKind,
  SecurityAlertConfidence,
  SecurityAlertSeverity,
  SecurityAlertStatus,
  TrustState,
  TrustTrigger,
} from "@prisma/client";

import type { TrustCategoryName } from "@/lib/trust/config";

/** What the pure scorer needs — gathered tenant-scoped by lib/trust/evidence.ts. */
export type TrustEvidence = {
  agent: { status: AgentStatus; createdAt: Date };
  /** Maturity of the agent's latest P2 baseline; null when none has been computed yet. */
  baselineMaturity: BaselineMaturity | null;
  deviations: {
    id: string;
    kind: BehavioralDeviationKind;
    dedupeKey: string;
    confidence: SecurityAlertConfidence;
    occurrences: number;
    lastSeenAt: Date;
  }[];
  /** PolicyEvaluation rows with decision BLOCK (kill-switch refusals already excluded). */
  blocks: { id: string; action: string; decisionSource: string | null; createdAt: Date }[];
  /** PolicyEvaluation rows with decision ALERT. */
  violations: { id: string; action: string; createdAt: Date }[];
  alerts: { id: string; type: string; title: string; severity: SecurityAlertSeverity; status: SecurityAlertStatus; lastSeenAt: Date }[];
  rejectedApprovals: { id: string; action: string; resolvedAt: Date }[];
};

export type TrustEvidenceRef = { type: "behavioral_deviation" | "policy_evaluation" | "security_alert" | "approval_request"; id: string };

/** One piece of evidence (or a group of the same kind) lowering trust. */
export type TrustFactor = {
  /** Stable identity, used to diff two evaluations. */
  key: string;
  category: TrustCategoryName;
  code: string;
  /** Points subtracted from 100 after decay and the category cap. */
  points: number;
  summary: string;
  /** Most recent evidence time (ISO). */
  at: string;
  evidence: TrustEvidenceRef[];
};

/** Something that bounds the state without being misbehavior. */
export type TrustLimit = {
  code: "OPERATOR_CONTROL" | "INSUFFICIENT_HISTORY";
  summary: string;
  /** Maximum score while the limit holds; null when it overrides the state instead. */
  ceiling: number | null;
};

export type TrustCategoryTotal = {
  category: TrustCategoryName;
  label: string;
  count: number;
  raw: number;
  applied: number;
  cap: number;
  capped: boolean;
};

export type TrustResult = {
  /** Evidence-based score before limits (100 − applied penalties), 0..100. */
  evidenceScore: number;
  /** After ceilings. */
  score: number;
  state: TrustState;
  factors: TrustFactor[];
  limits: TrustLimit[];
  categories: TrustCategoryTotal[];
  /** Factors beyond TRUST_MAX_FACTORS (counted in categories, not listed). */
  omittedFactors: number;
};

export type TrustChange = {
  key: string;
  category: TrustCategoryName | "limit";
  kind: "added" | "removed" | "increased" | "decreased";
  before: number;
  after: number;
  summary: string;
};

/** The persisted explanation snapshot of one evaluation. */
export type TrustSnapshot = {
  state: TrustState;
  score: number;
  factors: TrustFactor[];
  limits: TrustLimit[];
};

export type TrustTransitionDescription = {
  direction: "initialized" | "degraded" | "recovered" | "shifted";
  summary: string;
  changes: TrustChange[];
};

export type TrustEvaluationOptions = {
  trigger: TrustTrigger;
  triggerRef?: string | null;
  now?: Date;
};
