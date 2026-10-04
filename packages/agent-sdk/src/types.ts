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

export type DataClass = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "FINANCIAL" | "HEALTH" | "CREDENTIALS";

/**
 * Structured context about an action (0.6.0) — all optional, accepted by both
 * track() and authorize(). Send only what you know; Aegis never infers these.
 * Aegis normalizes them on receipt (see the README's "Structured telemetry").
 */
export type ActionContextFields = {
  /** The external service/API involved, e.g. "Stripe" — stored as a normalized key ("stripe"). */
  service?: string;
  /** Where data went: a URL, hostname, or email address. Only the host / email domain is stored — never paths, query strings, or the address itself. */
  destination?: string;
  /** Your id for the end user this action was on behalf of. Pseudonymized (keyed hash) before storage — the raw value is never stored. */
  endUserId?: string;
  /** What kind of data the action touched (case-insensitive). */
  dataClasses?: DataClass[];
  /** Your own sensitivity rating. Aegis derives one from `dataClasses` and keeps whichever is higher. */
  dataSensitivity?: RiskLevel;
  /** How many records were read/written/sent. */
  recordCount?: number;
  /** How many bytes were read/written/sent (max 2,147,483,647). */
  byteCount?: number;
  /** The Aegis `id` of the parent event (returned by an earlier track()/authorize()). */
  parentEventId?: string;
  /** Your own `clientEventId` of the parent event — linked even if the parent is reported later. Don't send both parent fields. */
  parentClientEventId?: string;
};

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

export type TrackEventInput = ActionContextFields & {
  agent: string;
  eventType: EventType;
  action: string;
  resource?: string;
  /** Optional human-readable summary shown in the Aegis activity feed instead of the raw `action` code, e.g. "Read customer record for Acme Corp". */
  description?: string;
  /** Which tool/integration performed this action, e.g. "CRM", "Zendesk" — feeds tool-based anomaly detection and the Activity page's Tool filter. */
  tool?: string;
  /**
   * SUCCESS/FAILURE describe whether the action itself errored. BLOCKED
   * (your own guardrail stopped it) and WARNING (it succeeded but your
   * agent flagged it as suspicious) let you self-report those outcomes
   * too — added in 0.3.0, existing track() calls keep working unmodified.
   */
  status?: "SUCCESS" | "FAILURE" | "BLOCKED" | "WARNING";
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
  /**
   * Makes retries of this one report safe (0.5.0). Auto-generated per
   * track() call if omitted, and reused across the SDK's own retries, so a
   * retried request can never record the same event twice.
   */
  idempotencyKey?: string;
  /**
   * Your own stable id for this event (0.6.0), unique per agent. Re-sending an
   * event with the same clientEventId (e.g. from your own retry queue after a
   * restart) returns the original instead of recording a duplicate; sending
   * different content under the same id is rejected (409). Also lets child
   * events name it as `parentClientEventId`.
   */
  clientEventId?: string;
  /** The `evaluationId` of the authorize() decision this action was executed under (0.6.0). */
  evaluationId?: string;
  /** When the action actually happened, if not "now" (within the last 30 days). Aegis also records its own receipt time. */
  occurredAt?: string | Date;
};

export type TrackEventResult = {
  id: string;
  traceId: string | null;
  /** 0.6.0 — the resolved parent (null if none, or if a parentClientEventId hasn't been reported yet). */
  parentEventId?: string | null;
  /** 0.6.0 — true when this repeated an already-recorded clientEventId and nothing new was written. */
  duplicate?: boolean;
};

/**
 * Shared shape for the trackX() convenience methods (0.4.0) — every field
 * `track()` accepts except `eventType`/`action`, which each method fills in
 * for you so callers never have to know Aegis's internal event taxonomy.
 * `action` stays overridable for a more specific machine-readable code
 * (e.g. "crm.contact.read" instead of the generic "data.read").
 */
export type ConvenienceEventInput = Omit<TrackEventInput, "eventType" | "action"> & { action?: string };

export type AuthorizeInput = ActionContextFields & {
  agent: string;
  action: string;
  resource?: string;
  environment?: Environment;
  tool?: string;
  riskLevel?: RiskLevel;
  context?: Record<string, JsonValue>;
  /** Auto-generated if omitted. */
  traceId?: string;
  /**
   * Makes a retried authorize() call for the same logical action safe — see
   * the SDK README's idempotency section. Auto-generated per authorize() call
   * if omitted (0.5.0) and reused across the SDK's own retries, so a retry
   * can never create a second evaluation or approval request.
   */
  idempotencyKey?: string;
  /**
   * An APPROVED approval request to use for this one execution (0.5.0).
   * Approvals are single-use and bound to the exact request that was
   * approved: send the same agent/action/resource/tool/context you sent the
   * first time. Returns ALLOW once; any reuse or mismatch returns BLOCK with
   * an `approvalDenialCode`. See the README's "safe execution pattern".
   */
  approvalRequestId?: string;
};

/** Which stage decided (0.5.0): the kill switch, a policy/permission, default deny, or an approval check. */
export type DecisionSource = "CONTROL" | "POLICY" | "DEFAULT_DENY" | "APPROVAL" | "RISK";
export type AgentStatus = "ACTIVE" | "PAUSED" | "STOPPED" | "NEEDS_ATTENTION" | "ARCHIVED";

/** Fields every decision carries (0.5.0 — additive; older servers may omit them). */
type DecisionCommon = {
  evaluationId: string;
  traceId: string;
  reason?: string;
  decisionSource?: DecisionSource;
  agentStatus?: AgentStatus;
};

export type AllowResult = DecisionCommon & {
  decision: "ALLOW";
  /** Set when this ALLOW consumed a human approval (single-use). */
  consumedApprovalRequestId?: string;
};
export type BlockResult = DecisionCommon & {
  decision: "BLOCK";
  /** Set when a referenced approval couldn't be used, e.g. "APPROVAL_ALREADY_USED", "APPROVAL_EXPIRED". */
  approvalDenialCode?: string;
};
export type RequireApprovalResult = DecisionCommon & {
  decision: "REQUIRE_APPROVAL";
  approvalRequestId: string;
  /** ISO timestamp after which the request expires undecided. */
  approvalExpiresAt?: string | null;
};
/** Server-side ALERT decision: the action is allowed and flagged (a "log" decision). */
export type AlertResult = DecisionCommon & { decision: "ALERT" };

/** Discriminate on `.decision` — TypeScript narrows the other fields for you. */
export type AuthorizationResult = AllowResult | BlockResult | RequireApprovalResult | AlertResult;

export type ApprovalStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export type ApprovalStatusResult = {
  id: string;
  status: ApprovalStatusValue;
  decision: "APPROVED" | "REJECTED" | null;
  resolvedAt: string | null;
  /** 0.5.0 — deadline for a human decision. */
  expiresAt?: string | null;
  /** 0.5.0 — once APPROVED, the approval must be used (via authorize({ approvalRequestId })) before this. */
  executionExpiresAt?: string | null;
  /** 0.5.0 — true once the approval has been used for its one execution. */
  consumed?: boolean;
  consumedAt?: string | null;
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

export type HandshakeInput = { sdkVersion?: string; framework?: string };

/** `established` is true only on the call that first connected the agent; repeats return false. */
export type HandshakeResult = {
  connected: true;
  established: boolean;
  agent: { slug: string; name: string };
  firstHandshakeAt: string;
  lastSeenAt: string;
};

/**
 * Input to guard() (0.7.0): everything authorize() accepts, plus how to behave
 * around the decision. Only the structured fields (agent, tool, resource,
 * telemetry) are copied onto the execution report; `context` is for the
 * decision only.
 */
export type GuardInput = AuthorizeInput & {
  /**
   * If Aegis cannot be reached (network, timeout, rate limit, 5xx):
   *   "closed" (default) — refuse: the tool does not run and AegisUnavailableError is thrown.
   *   "open"             — run the tool and report it as unguarded. Choose this only where an outage
   *                        must not stop the work and you accept that it ran without a decision.
   * A rejected request (bad key, invalid payload, unknown agent, 403) never fails open.
   */
  onUnavailable?: "closed" | "open";
  /** REQUIRE_APPROVAL: "throw" (default) AegisApprovalRequiredError, or "wait" for the human and run once if approved. */
  onApproval?: "throw" | "wait";
  /** With onApproval "wait": give up after this long (default: waitForApproval's 120s). */
  approvalTimeoutMs?: number;
  /** Optional details for the execution report guard() sends after the tool runs. */
  report?: Pick<TrackEventInput, "eventType" | "description" | "metadata" | "durationMs">;
  /** Called with the error when the execution report could not be sent. Never changes the outcome. */
  onReportError?: (error: unknown) => void;
};
