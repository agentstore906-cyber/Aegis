import { Badge } from "@/components/ui/badge";
import type {
  ActivityStatus,
  AgentStatus,
  ApprovalStatus,
  AuditResult,
  ConnectionStatus,
  PolicyDecision,
  PolicyStatus,
  RiskLevel,
  SecurityAlertSeverity,
  SecurityAlertStatus,
  TrustState,
} from "@prisma/client";

import {
  AGENT_STATE,
  APPROVAL,
  DECISION,
  RISK,
  TRUST,
  activityPresentation,
  approvalState,
  type ApprovalFacts,
  type Presentation,
  type StateTone,
} from "@/lib/ui/vocabulary";

/**
 * Every badge in the product. The words and tones come from lib/ui/vocabulary.ts
 * (one place decides what "blocked", "recorded" and "awaiting approval" mean);
 * this file only renders them. Color carries state; the label always says it too,
 * so state never depends on color alone.
 */

const BADGE_TONE = {
  safe: "success",
  warning: "warning",
  risk: "risk",
  blocked: "danger",
  approval: "approval",
  system: "info",
  neutral: "neutral",
} as const satisfies Record<StateTone, "success" | "warning" | "risk" | "danger" | "approval" | "info" | "neutral">;

/** Renders any Presentation. The `title` carries the full meaning for hover and assistive technology. */
export function PresentationBadge({ presentation, dot = true }: { presentation: Presentation; dot?: boolean }) {
  return (
    <span title={presentation.meaning}>
      <Badge tone={BADGE_TONE[presentation.tone]} dot={dot && presentation.tone !== "neutral"}>
        {presentation.label}
      </Badge>
    </span>
  );
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return <PresentationBadge presentation={AGENT_STATE[status]} />;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <PresentationBadge presentation={RISK[level]} dot={false} />;
}

export function TrustBadge({ state }: { state: TrustState }) {
  return <PresentationBadge presentation={TRUST[state]} />;
}

/** What Aegis returned for a request. */
export function DecisionBadge({ decision }: { decision: PolicyDecision }) {
  return <PresentationBadge presentation={DECISION[decision]} />;
}

export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  switch (status) {
    case "ACTIVE":
      return (
        <Badge tone="success" dot>
          Active
        </Badge>
      );
    case "DISABLED":
      return <Badge tone="neutral">Disabled</Badge>;
  }
}

/**
 * The state an approval is REALLY in (consumed, expired, usable…), derived from the same facts the backend
 * uses to allow consumption. Prefer this over ApprovalStatusBadge wherever the row's dates are available.
 */
export function ApprovalStateBadge({ approval, now = new Date() }: { approval: ApprovalFacts; now?: Date }) {
  return <PresentationBadge presentation={APPROVAL[approvalState(approval, now)]} />;
}

/** Status-only fallback (no dates available): never claims "usable" for an approved request. */
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  switch (status) {
    case "PENDING":
      return <PresentationBadge presentation={APPROVAL.AWAITING} />;
    case "APPROVED":
      return (
        <span title="Approved. Whether it can still be used depends on its execution window and whether it was already consumed.">
          <Badge tone="success" dot>
            Approved
          </Badge>
        </span>
      );
    case "REJECTED":
      return <PresentationBadge presentation={APPROVAL.REJECTED} />;
    case "EXPIRED":
      return <PresentationBadge presentation={APPROVAL.EXPIRED} />;
    case "CANCELLED":
      return <PresentationBadge presentation={APPROVAL.CANCELLED} />;
  }
}

export function AuditResultBadge({ result }: { result: AuditResult }) {
  switch (result) {
    case "SUCCESS":
      return <Badge tone="success">Success</Badge>;
    case "FAILURE":
      return <Badge tone="danger">Failure</Badge>;
  }
}

/**
 * An activity row's status. Pass `source` whenever the row has one: a row Aegis DECIDED on
 * ("policy_evaluation") says Allowed/Blocked/Awaiting approval; a row the AGENT reported ("api")
 * says Recorded / Reported blocked — Aegis decided nothing about it. Without a source it errs
 * toward the conservative reading.
 */
export function ActivityStatusBadge({ status, source }: { status: ActivityStatus; source?: string | null }) {
  return <PresentationBadge presentation={activityPresentation(status, source)} />;
}

const SEVERITY: Record<SecurityAlertSeverity, Presentation> = {
  LOW: { label: "Low", tone: "neutral", meaning: "Low severity." },
  MEDIUM: { label: "Medium", tone: "warning", meaning: "Medium severity." },
  HIGH: { label: "High", tone: "risk", meaning: "High severity." },
  CRITICAL: { label: "Critical", tone: "blocked", meaning: "Critical severity." },
};

export function SecurityAlertSeverityBadge({ severity }: { severity: SecurityAlertSeverity }) {
  return <PresentationBadge presentation={SEVERITY[severity]} dot={false} />;
}

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case "CONNECTED":
      return (
        <Badge tone="success" dot>
          Connected
        </Badge>
      );
    case "CONNECTING":
      return (
        <Badge tone="info" dot>
          Connecting
        </Badge>
      );
    case "VERIFYING":
      return (
        <Badge tone="info" dot>
          Verifying
        </Badge>
      );
    case "DEGRADED":
      return (
        <Badge tone="warning" dot>
          Degraded
        </Badge>
      );
    case "RECONNECT_REQUIRED":
      return (
        <Badge tone="warning" dot>
          Needs reconnect
        </Badge>
      );
    case "DISCONNECTED":
      return <Badge tone="neutral">Disconnected</Badge>;
    case "FAILED":
      return (
        <Badge tone="danger" dot>
          Failed
        </Badge>
      );
  }
}

export function SecurityAlertStatusBadge({ status }: { status: SecurityAlertStatus }) {
  switch (status) {
    case "OPEN":
      return (
        <Badge tone="warning" dot>
          Open
        </Badge>
      );
    case "ACKNOWLEDGED":
      return (
        <Badge tone="info" dot>
          Acknowledged
        </Badge>
      );
    case "RESOLVED":
      return <Badge tone="success">Resolved</Badge>;
  }
}
