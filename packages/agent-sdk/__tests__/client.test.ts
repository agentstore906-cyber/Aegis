import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Aegis } from "../src/client.js";
import {
  AegisAuthenticationError,
  AegisNetworkError,
  AegisRateLimitError,
  AegisTimeoutError,
  AegisValidationError,
} from "../src/errors.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-aegis-request-id": "req_test" },
    ...init,
  });
}

describe("Aegis client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client(overrides: Partial<ConstructorParameters<typeof Aegis>[0]> = {}) {
    return new Aegis({ apiKey: "aegis_test_x", baseUrl: "http://localhost:3000", timeoutMs: 200, maxRetries: 1, ...overrides });
  }

  describe("initialization", () => {
    it("throws AegisValidationError without an apiKey", () => {
      expect(() => new Aegis({ apiKey: "", baseUrl: "http://localhost:3000" })).toThrow(AegisValidationError);
    });

    it("throws AegisValidationError without a baseUrl", () => {
      expect(() => new Aegis({ apiKey: "aegis_test_x", baseUrl: "" })).toThrow(AegisValidationError);
    });

    it("constructs successfully with valid config", () => {
      expect(() => client()).not.toThrow();
    });
  });

  describe("track", () => {
    it("POSTs to /api/v1/events with the input as the body", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_1", traceId: "trace_1" }));

      const result = await client().track({ agent: "finance-agent", eventType: "TOOL_CALL", action: "invoice.read" });

      expect(result).toEqual({ id: "evt_1", traceId: "trace_1" });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe("http://localhost:3000/api/v1/events");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer aegis_test_x");
      expect(JSON.parse(init.body as string).agent).toBe("finance-agent");
    });

    it("passes through cost-intelligence fields when provided (0.2.0)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_2", traceId: "trace_2" }));

      await client().track({
        agent: "research-agent",
        eventType: "MODEL_CALL",
        action: "research.company",
        status: "SUCCESS",
        provider: "anthropic",
        model: "claude",
        inputTokens: 1820,
        outputTokens: 622,
        cost: 0.031,
        taskId: "task_1",
        taskType: "research",
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.inputTokens).toBe(1820);
      expect(body.outputTokens).toBe(622);
      expect(body.taskId).toBe("task_1");
      expect(body.taskType).toBe("research");
    });

    it("still works with a pre-0.2.0-shaped call (no cost-intelligence fields)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_3", traceId: "trace_3" }));

      const result = await client().track({ agent: "sales-agent", eventType: "TOOL_CALL", action: "crm.contact.read" });

      expect(result.id).toBe("evt_3");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.inputTokens).toBeUndefined();
      expect(body.taskId).toBeUndefined();
    });
  });

  describe("convenience trackX() methods (0.4.0)", () => {
    it.each([
      ["trackAgentStarted", {}, "SYSTEM", "agent.started"],
      ["trackAgentFinished", {}, "SYSTEM", "agent.finished"],
      ["trackToolCall", { tool: "CRM" }, "TOOL_CALL", "tool.called"],
      ["trackApiCall", {}, "ACTION", "api.called"],
      ["trackDataRead", {}, "DATA_ACCESS", "data.read"],
      ["trackDataWrite", {}, "DATA_ACCESS", "data.written"],
      ["trackMessageSent", {}, "COMMUNICATION", "message.sent"],
      ["trackError", {}, "SYSTEM", "error"],
      ["trackPermissionChanged", {}, "SYSTEM", "permission.changed"],
    ] as const)("%s() posts eventType=%s action=%s", async (method, extra, eventType, action) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_1", traceId: null }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client() as any)[method]({ agent: "finance-agent", ...extra });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.eventType).toBe(eventType);
      expect(body.action).toBe(action);
      expect(body.agent).toBe("finance-agent");
    });

    it("trackToolCall() passes tool through", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_1", traceId: null }));

      await client().trackToolCall({ agent: "sales-agent", tool: "CRM", resource: "contact:1" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.tool).toBe("CRM");
      expect(body.resource).toBe("contact:1");
    });

    it("trackError() defaults status to FAILURE but allows override", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_1", traceId: null }));
      await client().trackError({ agent: "a", description: "Timed out calling CRM" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).status).toBe("FAILURE");

      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_2", traceId: null }));
      await client().trackError({ agent: "a", status: "WARNING" });
      const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(init2.body as string).status).toBe("WARNING");
    });

    it("allows overriding the default action", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt_1", traceId: null }));
      await client().trackDataRead({ agent: "a", action: "crm.contact.read" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).action).toBe("crm.contact.read");
    });
  });

  describe("authorize", () => {
    it("returns an ALLOW result", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "eval_1", traceId: "trace_1" }));

      const result = await client().authorize({ agent: "finance-agent", action: "invoice.read" });

      expect(result.decision).toBe("ALLOW");
      if (result.decision === "ALLOW") expect(result.evaluationId).toBe("eval_1");
    });

    it("returns a BLOCK result with a reason", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ decision: "BLOCK", evaluationId: "eval_2", traceId: "trace_2", reason: "Blocked by policy" })
      );

      const result = await client().authorize({ agent: "finance-agent", action: "customer.delete" });

      expect(result.decision).toBe("BLOCK");
      if (result.decision === "BLOCK") expect(result.reason).toBe("Blocked by policy");
    });

    it("returns a REQUIRE_APPROVAL result with an approvalRequestId", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          decision: "REQUIRE_APPROVAL",
          evaluationId: "eval_3",
          approvalRequestId: "apr_1",
          traceId: "trace_3",
        })
      );

      const result = await client().authorize({ agent: "finance-agent", action: "refund.issue" });

      expect(result.decision).toBe("REQUIRE_APPROVAL");
      if (result.decision === "REQUIRE_APPROVAL") expect(result.approvalRequestId).toBe("apr_1");
    });

    it("auto-generates a traceId when none is supplied", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "eval_4", traceId: "trace_4" }));

      await client().authorize({ agent: "finance-agent", action: "invoice.read" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string);
      expect(typeof sentBody.traceId).toBe("string");
      expect(sentBody.traceId.length).toBeGreaterThan(0);
    });

    it("preserves a caller-supplied traceId", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "eval_5", traceId: "trace_custom" }));

      await client().authorize({ agent: "finance-agent", action: "invoice.read", traceId: "trace_custom" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).traceId).toBe("trace_custom");
    });

    it("sends an Idempotency-Key header when provided, and never sends it as a body field", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "eval_6", traceId: "trace_6" }));

      await client().authorize({ agent: "finance-agent", action: "invoice.read", idempotencyKey: "key-1" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(init.headers["Idempotency-Key"]).toBe("key-1");
      expect(JSON.parse(init.body as string).idempotencyKey).toBeUndefined();
    });
  });

  describe("idempotency and single-use approvals (0.5.0)", () => {
    type Init = RequestInit & { headers: Record<string, string> };

    it("generates an Idempotency-Key per authorize() call and reuses it across that call's retries", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "eval_r", traceId: "t" }));

      await client().authorize({ agent: "finance-agent", action: "invoice.read" });

      const keys = fetchMock.mock.calls.map(([, init]) => (init as Init).headers["Idempotency-Key"]);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(/^idem_/);
      expect(keys[1]).toBe(keys[0]);
    });

    it("uses a different key for each separate call (legitimate repeats are not deduplicated)", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "e1", traceId: "t" }))
        .mockResolvedValueOnce(jsonResponse({ decision: "ALLOW", evaluationId: "e2", traceId: "t" }));

      await client().authorize({ agent: "finance-agent", action: "invoice.read" });
      await client().authorize({ agent: "finance-agent", action: "invoice.read" });

      const keys = fetchMock.mock.calls.map(([, init]) => (init as Init).headers["Idempotency-Key"]);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it("track() also sends a per-call key, never as a body field", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt", traceId: null }));
      await client().track({ agent: "finance-agent", eventType: "ACTION", action: "x", idempotencyKey: "mine" });
      const [, init] = fetchMock.mock.calls[0] as [string, Init];
      expect(init.headers["Idempotency-Key"]).toBe("mine");
      expect(JSON.parse(init.body as string).idempotencyKey).toBeUndefined();
    });

    it("retries (same key) when the server says the original attempt is still in progress", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "IDEMPOTENCY_KEY_IN_PROGRESS", message: "in progress" } }, { status: 409 })
        )
        .mockResolvedValueOnce(jsonResponse({ decision: "BLOCK", evaluationId: "e", traceId: "t", reason: "no" }));

      const result = await client().authorize({ agent: "finance-agent", action: "invoice.read" });
      expect(result.decision).toBe("BLOCK");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry a genuine idempotency conflict", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { code: "IDEMPOTENCY_KEY_CONFLICT", message: "different body" } }, { status: 409 })
      );
      await expect(client().authorize({ agent: "finance-agent", action: "invoice.read" })).rejects.toBeInstanceOf(
        AegisValidationError
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("passes approvalRequestId through to consume an approval", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ decision: "ALLOW", evaluationId: "e", traceId: "t", decisionSource: "APPROVAL", consumedApprovalRequestId: "apr_1" })
      );
      const result = await client().authorize({ agent: "finance-agent", action: "refund.issue", approvalRequestId: "apr_1" });
      const [, init] = fetchMock.mock.calls[0] as [string, Init];
      expect(JSON.parse(init.body as string).approvalRequestId).toBe("apr_1");
      expect(result.decision === "ALLOW" && result.consumedApprovalRequestId).toBe("apr_1");
    });
  });

  describe("structured telemetry (0.6.0)", () => {
    it("passes context fields through and serializes occurredAt as ISO-8601", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "evt", traceId: "t", parentEventId: "evt_parent", duplicate: false }));
      const occurredAt = new Date("2026-10-01T10:42:00.000Z");
      const result = await client().track({
        agent: "finance-agent",
        eventType: "DATA_ACCESS",
        action: "crm.export",
        clientEventId: "export-1",
        parentClientEventId: "task-1",
        evaluationId: "eval_1",
        destination: "https://files.example.com/upload",
        dataClasses: ["PII"],
        recordCount: 1200,
        occurredAt,
      });
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body).toMatchObject({
        clientEventId: "export-1",
        parentClientEventId: "task-1",
        evaluationId: "eval_1",
        destination: "https://files.example.com/upload",
        dataClasses: ["PII"],
        recordCount: 1200,
        occurredAt: "2026-10-01T10:42:00.000Z",
      });
      expect(result).toMatchObject({ parentEventId: "evt_parent", duplicate: false });
    });
  });

  describe("waitForApproval", () => {
    it("returns once the status is no longer PENDING", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ id: "apr_1", status: "PENDING", decision: null, resolvedAt: null }))
        .mockResolvedValueOnce(
          jsonResponse({ id: "apr_1", status: "APPROVED", decision: "APPROVED", resolvedAt: "2026-01-01T00:00:00Z" })
        );

      const result = await client().waitForApproval({ approvalRequestId: "apr_1", timeoutMs: 2000, intervalMs: 10 });

      expect(result.status).toBe("APPROVED");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("resolves (does not throw) for a REJECTED outcome", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: "apr_2", status: "REJECTED", decision: "REJECTED", resolvedAt: "2026-01-01T00:00:00Z" })
      );

      const result = await client().waitForApproval({ approvalRequestId: "apr_2", timeoutMs: 2000, intervalMs: 10 });

      expect(result.status).toBe("REJECTED");
    });

    it("throws AegisTimeoutError if still PENDING after the deadline", async () => {
      // A fresh Response per call — mockResolvedValue would reuse one Response
      // instance across polls, and a body can only be read (.json()) once.
      fetchMock.mockImplementation(async () =>
        jsonResponse({ id: "apr_3", status: "PENDING", decision: null, resolvedAt: null })
      );

      await expect(
        client().waitForApproval({ approvalRequestId: "apr_3", timeoutMs: 60, intervalMs: 10 })
      ).rejects.toThrow(AegisTimeoutError);
    });
  });

  describe("error mapping", () => {
    it("throws AegisAuthenticationError on 401, without retrying", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "INVALID_API_KEY", message: "The provided API key is invalid." } }, { status: 401 })
      );

      await expect(client().track({ agent: "a", eventType: "TOOL_CALL", action: "x" })).rejects.toThrow(
        AegisAuthenticationError
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws AegisRateLimitError after exhausting retries on 429", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests." } }), {
          status: 429,
          headers: { "retry-after": "0" },
        })
      );

      await expect(client({ maxRetries: 1 }).track({ agent: "a", eventType: "TOOL_CALL", action: "x" })).rejects.toThrow(
        AegisRateLimitError
      );
      expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial attempt + 1 retry
    });

    it("throws AegisNetworkError when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      await expect(client({ maxRetries: 1 }).track({ agent: "a", eventType: "TOOL_CALL", action: "x" })).rejects.toThrow(
        AegisNetworkError
      );
    });
  });
});

describe("Aegis.handshake", () => {
  it("POSTs to the handshake endpoint with the bearer key and returns what the server confirmed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ connected: true, established: true, agent: { slug: "a", name: "A" }, firstHandshakeAt: "2026-10-03T00:00:00.000Z", lastSeenAt: "2026-10-03T00:00:00.000Z" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const aegis = new Aegis({ apiKey: "aegis_live_x", baseUrl: "https://aegis.example/" });
    const result = await aegis.handshake({ sdkVersion: "0.8.0", framework: "custom" });
    expect(result.established).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://aegis.example/api/v1/connect/handshake");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization ?? (init.headers as Record<string, string>).Authorization).toBe("Bearer aegis_live_x");
    expect(JSON.parse(String(init.body))).toEqual({ sdkVersion: "0.8.0", framework: "custom" });
    vi.unstubAllGlobals();
  });
});
