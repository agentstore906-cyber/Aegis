import { randomUUID } from "node:crypto";

import { HttpClient } from "./http.js";
import { AegisTimeoutError, AegisValidationError } from "./errors.js";
import { guard } from "./guard.js";
import type {
  AegisConfig,
  ApprovalStatusResult,
  AuthorizationResult,
  AuthorizeInput,
  AlertResult,
  AllowResult,
  GuardInput,
  ConvenienceEventInput,
  HandshakeInput,
  HandshakeResult,
  RegisterAgentInput,
  RegisterAgentResult,
  TrackEventInput,
  TrackEventResult,
  WaitForApprovalInput,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 5_000;
const POLL_BACKOFF_FACTOR = 1.5;

function generateTraceId(): string {
  return `trace_${randomUUID()}`;
}

function generateIdempotencyKey(): string {
  return `idem_${randomUUID()}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new AegisTimeoutError("waitForApproval was aborted."));
      },
      { once: true }
    );
  });
}

/**
 * The Aegis agent SDK. Never executes a tool or resumes agent work on its
 * own — it only tells you what Aegis decided. Your code decides what to
 * do with `ALLOW` / `BLOCK` / `REQUIRE_APPROVAL` (see the README's "safe
 * execution pattern").
 */
export class Aegis {
  private readonly http: HttpClient;

  constructor(config: AegisConfig) {
    if (!config.apiKey) {
      throw new AegisValidationError(
        "Aegis requires an `apiKey`. Create one from your Aegis dashboard's Developers > API Keys page."
      );
    }
    if (!config.baseUrl) {
      throw new AegisValidationError(
        "Aegis requires a `baseUrl` pointing at your Aegis deployment (e.g. http://localhost:3000 in development)."
      );
    }

    this.http = new HttpClient(
      config.apiKey,
      config.baseUrl.replace(/\/$/, ""),
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      config.maxRetries ?? DEFAULT_MAX_RETRIES
    );
  }

  /**
   * Reports an action your agent already took. Does not ask for
   * authorization — see `authorize()` for that. Sends an Idempotency-Key
   * (yours, or one generated per call) that is reused across retries, so a
   * retry never records the event twice.
   */
  async track(input: TrackEventInput): Promise<TrackEventResult> {
    const { idempotencyKey, ...body } = input;
    return this.http.request<TrackEventResult>({
      method: "POST",
      path: "/api/v1/events",
      body,
      idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
    });
  }

  // Convenience wrappers around track() (0.4.0) — each fills in the
  // eventType/action pair for a common event so you never have to look up
  // Aegis's internal taxonomy. All optional fields from track() still work
  // (resource, metadata, cost, ...); `action` can be overridden for a more
  // specific machine-readable code.

  /** Your agent process started a run. */
  async trackAgentStarted(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "SYSTEM", action: input.action ?? "agent.started" });
  }

  /** Your agent process finished a run. */
  async trackAgentFinished(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "SYSTEM", action: input.action ?? "agent.finished" });
  }

  /** Your agent invoked a tool/integration — `tool` is required so this always shows up under the right integration. */
  async trackToolCall(input: ConvenienceEventInput & { tool: string }): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "TOOL_CALL", action: input.action ?? "tool.called" });
  }

  /** Your agent called an external API. */
  async trackApiCall(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "ACTION", action: input.action ?? "api.called" });
  }

  /** Your agent read data (a record, a file, a query result). */
  async trackDataRead(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "DATA_ACCESS", action: input.action ?? "data.read" });
  }

  /** Your agent wrote/modified data. */
  async trackDataWrite(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "DATA_ACCESS", action: input.action ?? "data.written" });
  }

  /** Your agent sent a message (email, chat, notification, ...). */
  async trackMessageSent(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "COMMUNICATION", action: input.action ?? "message.sent" });
  }

  /** Your agent hit an error. Defaults `status` to "FAILURE" — pass your own to override. */
  async trackError(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "SYSTEM", action: input.action ?? "error", status: input.status ?? "FAILURE" });
  }

  /** Your agent's own permissions/scopes changed. */
  async trackPermissionChanged(input: ConvenienceEventInput): Promise<TrackEventResult> {
    return this.track({ ...input, eventType: "SYSTEM", action: input.action ?? "permission.changed" });
  }

  /**
   * Asks Aegis whether your agent may perform an action. Auto-generates a
   * traceId if you don't supply one, and an Idempotency-Key per call (reused
   * across this call's retries) so a retry can never create a duplicate
   * evaluation or approval request. Pass `approvalRequestId` to use an
   * APPROVED approval for its single execution.
   */
  async authorize(input: AuthorizeInput): Promise<AuthorizationResult> {
    const { idempotencyKey, ...rest } = input;
    const body = { ...rest, traceId: input.traceId ?? generateTraceId() };
    return this.http.request<AuthorizationResult>({
      method: "POST",
      path: "/api/v1/evaluate",
      body,
      idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
    });
  }

  /** Fetches the current state of a REQUIRE_APPROVAL decision without waiting. */
  async getApprovalStatus(approvalRequestId: string): Promise<ApprovalStatusResult> {
    return this.http.request<ApprovalStatusResult>({
      method: "GET",
      path: `/api/v1/approvals/${encodeURIComponent(approvalRequestId)}`,
    });
  }

  /**
   * Polls approval status with capped exponential backoff until it's no
   * longer PENDING, or `timeoutMs` elapses (default 120s — this never
   * waits forever unless you explicitly ask it to via a very large
   * value). Throws `AegisTimeoutError` on timeout or abort, never
   * resolves with a stale PENDING result.
   */
  async waitForApproval(input: WaitForApprovalInput): Promise<ApprovalStatusResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let intervalMs = input.intervalMs ?? MIN_POLL_INTERVAL_MS;

    for (;;) {
      if (input.signal?.aborted) {
        throw new AegisTimeoutError("waitForApproval was aborted.");
      }

      const result = await this.getApprovalStatus(input.approvalRequestId);
      if (result.status !== "PENDING") return result;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new AegisTimeoutError(
          `Approval request ${input.approvalRequestId} was still PENDING after ${timeoutMs}ms.`
        );
      }

      await delay(Math.min(intervalMs, remainingMs), input.signal);
      intervalMs = Math.min(intervalMs * POLL_BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
    }
  }

  /**
   * In-process enforcement for one tool call (0.7.0): authorize, run `fn` only on an allowing decision,
   * and report the outcome under that decision. Fails CLOSED by default. It guards the calls you route
   * through it — it cannot stop code that calls the tool directly. See the README's "guard()" section.
   */
  async guard<T>(input: GuardInput, fn: (decision: AllowResult | AlertResult | null) => Promise<T> | T): Promise<T> {
    return guard(this, input, fn);
  }

  /**
   * Tells Aegis "this agent is up and reachable with this credential" (0.8.0). Aegis marks the connection
   * established only because this authenticated request actually arrived; it is idempotent, so calling it on every
   * start is safe. Needs a key bound to one agent (the one the dashboard issued when you connected the agent).
   */
  async handshake(input: HandshakeInput = {}): Promise<HandshakeResult> {
    return this.http.request<HandshakeResult>({ method: "POST", path: "/api/v1/connect/handshake", body: input });
  }

  /** Lightweight auto-provisioning so a new agent doesn't need a dashboard visit before its first event/authorize call. */
  async registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    return this.http.request<RegisterAgentResult>({ method: "POST", path: "/api/v1/agents/register", body: input });
  }
}
