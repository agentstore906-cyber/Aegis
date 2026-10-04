import type { AgentTypeId, AutonomyId, CapabilityId, ControlId, ControlState } from "@/lib/scanner/catalog";

/** A validated, normalised scan request. Contains no free text except a short sanitised label. */
export type ScanInput = {
  agentType: AgentTypeId;
  /** Only for agentType "other"; sanitised; never shown on public pages. */
  agentLabel: string | null;
  capabilities: CapabilityId[];
  autonomy: AutonomyId[];
  controls: Partial<Record<ControlId, ControlState>>;
  /** Optional pasted text. Analysed in memory by lib/scanner/pasted.ts and then discarded — never persisted. */
  advancedText: string | null;
};

export type Severity = "critical" | "high" | "medium" | "low";
export type RiskLevel = "low" | "moderate" | "high" | "critical";

export const RISK_CATEGORIES = [
  "excessive_permissions",
  "unrestricted_tool_access",
  "autonomous_external_actions",
  "sensitive_data_exposure",
  "code_execution_risk",
  "prompt_injection_exposure",
  "missing_approval_gates",
  "missing_monitoring",
  "weak_secrets_isolation",
  "excessive_blast_radius",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

/** Where a piece of evidence came from — the report distinguishes these on purpose. */
export type EvidenceKind = "observed" | "inferred";
export type Evidence = { kind: EvidenceKind; text: string };

/**
 * What Aegis can actually do about a finding today. Never "prevents": Aegis returns decisions to agents
 * that ask (SDK guard()/evaluate) and records what happened; it is not in the agent's data path.
 */
export type AegisCoverage = "monitor_and_control" | "monitor" | "partial" | "guidance_only";

export type AegisControlRef = {
  id: string;
  name: string;
  /** available = shipped; partial = shipped with stated limits; coming_soon = NOT built yet; not_provided = out of Aegis's scope. */
  status: "available" | "partial" | "coming_soon" | "not_provided";
  note: string;
  /** Dashboard path, only for shipped controls. */
  href?: string;
};

export type Finding = {
  id: RiskCategory;
  title: string;
  severity: Severity;
  /** Severity before the controls the user reported were taken into account. */
  inherentSeverity: Severity;
  /** One sentence: what the configuration indicates (observed). */
  headline: string;
  whyItMatters: string;
  evidence: Evidence[];
  potentialImpact: string;
  mitigations: string[];
  aegis: { coverage: AegisCoverage; summary: string; controls: AegisControlRef[] };
  /** Points this finding contributes before combining (see scoring methodology). */
  points: number;
  /** Which report dimension it rolls up into. */
  dimension: Dimension;
};

export const DIMENSIONS = ["permissions", "autonomy", "data", "execution", "monitoring", "blast_radius"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type ProtectedArea = { id: RiskCategory; title: string; because: string };
export type NotIndicatedArea = { id: RiskCategory; title: string };

export type PastedSignalSummary = {
  /** Count of characters analysed (the text itself is never stored). */
  chars: number;
  /** Allowlisted signal ids with capped counts. */
  signals: { id: string; label: string; count: number }[];
  /** Capabilities inferred from the text and merged into the analysis as INFERRED evidence. */
  inferredCapabilities: CapabilityId[];
};

export type ScanResult = {
  engineVersion: string;
  score: number;
  level: RiskLevel;
  counts: { high: number; medium: number; low: number; protectedAreas: number };
  findings: Finding[];
  protectedAreas: ProtectedArea[];
  notIndicated: NotIndicatedArea[];
  breakdown: { dimension: Dimension; label: string; score: number }[];
  /** "What to fix first": finding ids ordered by impact. */
  fixFirst: RiskCategory[];
  /** How many of the 10 controls the user actually answered with something other than "not sure". */
  controlsConfirmed: number;
  controlsTotal: number;
  pasted: PastedSignalSummary | null;
  /** Fixed, honest statement of what the number is and is not. */
  disclaimer: string;
};
