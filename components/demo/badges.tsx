import { Badge } from "@/components/ui/badge";
import type {
  DemoAgentStatus,
  DemoRunStatus,
  DemoStepStatus,
  DemoAlertSeverity,
  DemoAlertStatus,
} from "./types";

export function DemoAgentStatusBadge({ status }: { status: DemoAgentStatus }) {
  if (status === "active") {
    return (
      <Badge tone="success" dot>
        Active
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" dot>
      Paused
    </Badge>
  );
}

export function DemoRunStatusBadge({ status }: { status: DemoRunStatus }) {
  switch (status) {
    case "success":
      return (
        <Badge tone="success" dot>
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger" dot>
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge tone="info" dot>
          Running
        </Badge>
      );
  }
}

export function DemoStepStatusBadge({ status }: { status: DemoStepStatus }) {
  switch (status) {
    case "success":
      return <Badge tone="success">Done</Badge>;
    case "failed":
      return <Badge tone="danger">Failed</Badge>;
    case "pending":
      return <Badge tone="info">In progress</Badge>;
  }
}

export function DemoAlertSeverityBadge({ severity }: { severity: DemoAlertSeverity }) {
  switch (severity) {
    case "critical":
      return <Badge tone="danger">Critical</Badge>;
    case "high":
      return <Badge tone="warning">High</Badge>;
    case "medium":
      return <Badge tone="info">Medium</Badge>;
  }
}

export function DemoAlertStatusBadge({ status }: { status: DemoAlertStatus }) {
  if (status === "open") {
    return (
      <Badge tone="warning" dot>
        Open
      </Badge>
    );
  }
  return <Badge tone="success">Resolved</Badge>;
}
