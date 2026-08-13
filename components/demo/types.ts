export type DemoAgentStatus = "active" | "paused";

export type DemoRunStatus = "success" | "failed" | "running";

export type DemoStepStatus = "success" | "failed" | "pending";

export type DemoStepKind = "start" | "tool" | "api" | "model" | "end";

export type DemoAlertSeverity = "critical" | "high" | "medium";

export type DemoAlertStatus = "open" | "resolved";

export type DemoAlertAction = "pause" | "acknowledge";

export interface DemoStep {
  id: string;
  kind: DemoStepKind;
  label: string;
  detail: string;
  status: DemoStepStatus;
  durationMs: number;
  tokens?: number;
  costCents?: number;
}

export interface DemoRun {
  id: string;
  agentId: string;
  startedAt: string;
  status: DemoRunStatus;
  durationMs: number;
  totalTokens: number;
  costCents: number;
  steps: DemoStep[];
}

export interface DemoAgent {
  id: string;
  name: string;
  role: string;
  status: DemoAgentStatus;
  model: string;
  runs: number;
  costCents: number;
  successRate: number;
  avgLatencyMs: number;
  tokenUsage: number;
  lastActiveAt: string;
}

export interface DemoAlert {
  id: string;
  agentId: string;
  severity: DemoAlertSeverity;
  status: DemoAlertStatus;
  title: string;
  description: string;
  evidence: { label: string; value: string }[];
  detectedAt: string;
  action: DemoAlertAction;
}

export interface DemoActivityItem {
  id: string;
  runId: string;
  agentId: string;
  timestamp: string;
  summary: string;
  status: DemoRunStatus;
}
