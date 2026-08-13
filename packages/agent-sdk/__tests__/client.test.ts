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
