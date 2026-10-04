import { Badge } from "@/components/ui/badge";
import { LEVEL_LABEL } from "@/lib/scanner/engine";
import type { AegisControlRef, AegisCoverage, RiskLevel, Severity } from "@/lib/scanner/types";

export const LEVEL_TONE = { low: "success", moderate: "warning", high: "risk", critical: "danger" } as const satisfies Record<RiskLevel, string>;
export const SEVERITY_TONE = { low: "info", medium: "warning", high: "risk", critical: "danger" } as const satisfies Record<Severity, string>;
const SEVERITY_LABEL: Record<Severity, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

export function LevelBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge tone={LEVEL_TONE[level]} dot>
      {LEVEL_LABEL[level]} risk
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export const COVERAGE_LABEL: Record<AegisCoverage, string> = {
  monitor_and_control: "Aegis can monitor and help control this",
  monitor: "Aegis can monitor and record this",
  partial: "Partly addressable with Aegis",
  guidance_only: "Guidance only — Aegis can’t control this today",
};

const CONTROL_STATUS: Record<AegisControlRef["status"], { label: string; tone: "success" | "warning" | "neutral" | "info" }> = {
  available: { label: "Available", tone: "success" },
  partial: { label: "Available, with limits", tone: "warning" },
  coming_soon: { label: "Coming soon", tone: "info" },
  not_provided: { label: "Outside Aegis", tone: "neutral" },
};

export function ControlStatusBadge({ status }: { status: AegisControlRef["status"] }) {
  const s = CONTROL_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
