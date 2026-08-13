export type Environment = "production" | "staging" | "development";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EventType =
  | "TOOL_CALL"
  | "MODEL_CALL"
  | "DATA_ACCESS"
  | "ACTION"
  | "DEPLOYMENT"
  | "COMMUNICATION"
  | "FINANCIAL"
  | "SYSTEM";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AegisConfig = {
  apiKey: string;
  /** Base URL of your Aegis deployment, e.g. "http://localhost:3000" in development or your production origin. */
  baseUrl: string;
  /** Per-request timeout. Default 10000ms. */
  timeoutMs?: number;
  /** Max retry attempts for transient failures (429/5xx/network). Default 2. */
  maxRetries?: number;
};

export type TrackEventInput = {
  agent: string;
  eventType: EventType;
  action: string;
  resource?: string;
  status?: "SUCCESS" | "FAILURE";
  traceId?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
  cost?: number;
  /** Cost-intelligence detail (added in 0.2.0) — all optional, existing track() calls keep working unmodified. */
  inputTokens?: number;
  outputTokens?: number;
  taskId?: string;
  taskType?: string;
  metadata?: Record<string, JsonValue>;
};

export type TrackEventResult = { id: string; traceId: string | null };

export type AuthorizeInput = {
  agent: string;
  action: string;
  resource?: string;
  environment?: Environment;
  tool?: string;
  riskLevel?: RiskLevel;
  context?: Record<string, JsonValue>;
  /** Auto-generated if omitted. */
  traceId?: string;
  /** Makes a retried authorize() call for the same logical action safe — see the SDK README's idempotency section. */
  idempotencyKey?: string;
};

export type AllowResult = { decision: "ALLOW"; evaluationId: string; traceId: string };
export type BlockResult = { decision: "BLOCK"; evaluationId: string; traceId: string; reason?: string };
export type RequireApprovalResult = {
  decision: "REQUIRE_APPROVAL";
  evaluationId: string;
  approvalRequestId: string;
  traceId: string;
};

/** Discriminate on `.decision` — TypeScript narrows the other fields for you. */
export type AuthorizationResult = AllowResult | BlockResult | RequireApprovalResult;

export type ApprovalStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export type ApprovalStatusResult = {
  id: string;
  status: ApprovalStatusValue;
  decision: "APPROVED" | "REJECTED" | null;
  resolvedAt: string | null;
};

export type WaitForApprovalInput = {
  approvalRequestId: string;
  /** Give up and throw AegisTimeoutError after this long. Default 120000ms — never waits forever. */
  timeoutMs?: number;
  /** Initial poll interval; backs off up to a 5s cap. Default 1000ms. */
  intervalMs?: number;
  signal?: AbortSignal;
};

export type RegisterAgentInput = {
  name: string;
  owner?: string;
  modelProvider?: string;
  modelName?: string;
  environment?: Environment;
  riskLevel?: RiskLevel;
};

export type RegisterAgentResult = { id: string; slug: string; name: string; created: boolean };
