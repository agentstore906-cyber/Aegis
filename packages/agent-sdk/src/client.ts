import { randomUUID } from "node:crypto";

import { HttpClient } from "./http.js";
import { AegisTimeoutError, AegisValidationError } from "./errors.js";
import type {
  AegisConfig,
  ApprovalStatusResult,
  AuthorizationResult,
  AuthorizeInput,
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

  /** Reports an action your agent already took. Does not ask for authorization — see `authorize()` for that. */
  async track(input: TrackEventInput): Promise<TrackEventResult> {
    return this.http.request<TrackEventResult>({ method: "POST", path: "/api/v1/events", body: input });
  }

  /** Asks Aegis whether your agent may perform an action. Auto-generates a traceId if you don't supply one. */
  async authorize(input: AuthorizeInput): Promise<AuthorizationResult> {
    const { idempotencyKey, ...rest } = input;
    const body = { ...rest, traceId: input.traceId ?? generateTraceId() };
    return this.http.request<AuthorizationResult>({
      method: "POST",
      path: "/api/v1/evaluate",
      body,
      idempotencyKey,
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

  /** Lightweight auto-provisioning so a new agent doesn't need a dashboard visit before its first event/authorize call. */
  async registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    return this.http.request<RegisterAgentResult>({ method: "POST", path: "/api/v1/agents/register", body: input });
  }
}
