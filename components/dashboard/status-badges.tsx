import { Badge } from "@/components/ui/badge";
import type { ActivityStatus, AgentStatus, RiskLevel } from "@prisma/client";

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  switch (status) {
    case "ACTIVE":
      return (
        <Badge tone="success" dot>
          Active
        </Badge>
      );
    case "PAUSED":
      return (
        <Badge tone="neutral" dot>
          Paused
        </Badge>
      );
    case "NEEDS_ATTENTION":
      return (
        <Badge tone="warning" dot>
          Needs attention
        </Badge>
      );
    case "ARCHIVED":
      return (
        <Badge tone="neutral" dot>
          Archived
        </Badge>
      );
  }
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  switch (level) {
    case "LOW":
      return <Badge tone="neutral">Low</Badge>;
    case "MEDIUM":
      return <Badge tone="info">Medium</Badge>;
    case "HIGH":
      return <Badge tone="warning">High</Badge>;
    case "CRITICAL":
      return <Badge tone="danger">Critical</Badge>;
  }
}

export function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  switch (status) {
    case "ALLOWED":
      return (
        <Badge tone="success" dot>
          Allowed
        </Badge>
      );
    case "BLOCKED":
      return (
        <Badge tone="danger" dot>
          Blocked
        </Badge>
      );
    case "APPROVAL_REQUIRED":
      return (
        <Badge tone="warning" dot>
          Approval required
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="danger" dot>
          Failed
        </Badge>
      );
  }
}
