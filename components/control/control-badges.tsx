import { Badge } from "@/components/ui/badge";
import { ATTENTION_FLAG_LABEL, type AdoptionStage, type AgentPosture, type AttentionFlag } from "@/lib/control/posture";
import type { EnforcementCoverage } from "@/lib/control/coverage";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const POSTURE: Record<AgentPosture, { label: string; tone: Tone; hint: string }> = {
  PROTECTED: { label: "Asks Aegis", tone: "success", hint: "Requests decisions from Aegis. Aegis returns decisions; it cannot stop an integration that ignores them." },
  OBSERVED: { label: "Observed only", tone: "info", hint: "Reports activity but never asks for a decision" },
  QUIET: { label: "Quiet", tone: "neutral", hint: "Configured, no activity this week" },
  DISCOVERED: { label: "Discovered", tone: "warning", hint: "Nothing granted yet: Aegis default-denies everything it asks for" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "warning", hint: "Flagged by an operator" },
  PAUSED: { label: "Paused", tone: "neutral", hint: "Kill switch (temporary)" },
  STOPPED: { label: "Stopped", tone: "danger", hint: "Kill switch" },
  RETIRED: { label: "Retired", tone: "neutral", hint: "Archived" },
};

export function PostureBadge({ posture }: { posture: AgentPosture }) {
  const p = POSTURE[posture];
  return (
    <span title={p.hint}>
      <Badge tone={p.tone}>{p.label}</Badge>
    </span>
  );
}

export const postureLabel = (posture: AgentPosture) => POSTURE[posture].label;

export function AdoptionBadge({ stage }: { stage: AdoptionStage }) {
  const label = { CONNECTED: "Connected", OBSERVING: "Observing", PROTECTED: "Asking for decisions" }[stage];
  return <Badge tone={stage === "PROTECTED" ? "success" : stage === "OBSERVING" ? "info" : "neutral"}>{label}</Badge>;
}

const FLAG_TONE: Record<AttentionFlag, Tone> = {
  TRUST_DEGRADED: "warning",
  UNUSUAL_BEHAVIOR: "warning",
  OPEN_INCIDENT: "danger",
  PENDING_APPROVAL: "info",
  BROAD_GRANT: "warning",
  SHARED_IDENTITY: "warning",
  RAN_DESPITE_DECISION: "danger",
  NO_OWNER: "neutral",
};

export function FlagBadges({ flags }: { flags: AttentionFlag[] }) {
  if (flags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone={FLAG_TONE[f]}>
          {ATTENTION_FLAG_LABEL[f]}
        </Badge>
      ))}
    </span>
  );
}

/** Enforcement coverage in words: never 0% or 100% when there is no evidence. */
export function coverageText(c: EnforcementCoverage): string {
  if (c.coverage === null) return "no evidence";
  return `${Math.round(c.coverage * 100)}% (${c.decided}/${c.reportedActions})`;
}
