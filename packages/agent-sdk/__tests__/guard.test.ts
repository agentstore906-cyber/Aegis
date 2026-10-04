import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Aegis } from "../src/client.js";
import {
  AegisApprovalRequiredError,
  AegisAuthenticationError,
  AegisApiError,
  AegisBlockedError,
  AegisUnavailableError,
  AegisValidationError,
} from "../src/errors.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-aegis-request-id": "req_g" } });

type Call = { path: string; body: Record<string, unknown>; headers: Record<string, string> };

describe("guard()", () => {
  let calls: Call[];
  let authorizeQueue: (() => Response | Promise<Response>)[];
  let approvalQueue: (() => Response)[];
  let eventsHandler: () => Response | Promise<Response>;

  const allow = (over: Record<string, unknown> = {}) => () => json({ decision: "ALLOW", evaluationId: "eval_1", traceId: "trace_1", reason: "ok", ...over });
  const block = () => json({ decision: "BLOCK", evaluationId: "eval_b", traceId: "trace_b", reason: "Blocked by policy", decisionSource: "POLICY" });
  const needsApproval = () => json({ decision: "REQUIRE_APPROVAL", evaluationId: "eval_r", traceId: "trace_r", reason: "Approval required", approvalRequestId: "appr_1" });

  beforeEach(() => {
    calls = [];
    authorizeQueue = [];
    approvalQueue = [];
    eventsHandler = () => json({ id: "evt_1", traceId: "trace_1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
        const path = new URL(url).pathname;
        calls.push({ path, body: init.body ? JSON.parse(init.body as string) : {}, headers: init.headers });
        if (path === "/api/v1/evaluate") return (authorizeQueue.shift() ?? (() => json({ error: { code: "X", message: "unexpected authorize" } }, 500)))();
        if (path.startsWith("/api/v1/approvals/")) return (approvalQueue.shift() ?? (() => json({ id: "appr_1", status: "PENDING", decision: null, resolvedAt: null })))();
        if (path === "/api/v1/events") return eventsHandler();
        throw new Error(`unexpected request to ${path}`);
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const client = () => new Aegis({ apiKey: "aegis_test_x", baseUrl: "http://localhost:3000", timeoutMs: 200, maxRetries: 0 });
  const request = { agent: "finance-agent", action: "refund.issue", resource: "order:42", tool: "billing", context: { amount: 1250 } };
  const paths = () => calls.map((c) => c.path);

  describe("allowing decisions run the tool exactly once and report it under the decision", () => {
    it("ALLOW: runs, returns the tool's value, and reports SUCCESS linked to the evaluation", async () => {
      authorizeQueue.push(allow());
      const tool = vi.fn(async () => "refunded");
      const result = await client().guard(request, tool);

      expect(result).toBe("refunded");
      expect(tool).toHaveBeenCalledTimes(1);
      expect(tool).toHaveBeenCalledWith(expect.objectContaining({ decision: "ALLOW", evaluationId: "eval_1" }));
      expect(paths()).toEqual(["/api/v1/evaluate", "/api/v1/events"]);
      const report = calls[1].body;
      expect(report).toMatchObject({ agent: "finance-agent", action: "refund.issue", resource: "order:42", tool: "billing", eventType: "TOOL_CALL", status: "SUCCESS", evaluationId: "eval_1", traceId: "trace_1" });
      expect(typeof report.durationMs).toBe("number");
    });

    it("ALERT also runs (it is an allow-with-flag)", async () => {
      authorizeQueue.push(() => json({ decision: "ALERT", evaluationId: "eval_a", traceId: "t", reason: "flagged" }));
      const tool = vi.fn(() => 7);
      expect(await client().guard(request, tool)).toBe(7);
      expect(tool).toHaveBeenCalledTimes(1);
    });

    it("the decision context is for the decision only: it is not copied into the execution report", async () => {
      authorizeQueue.push(allow());
      await client().guard({ ...request, context: { amount: 1250, secret: "hunter2" }, recordCount: 3 }, () => "x");
      const report = calls[1].body;
      expect(report).not.toHaveProperty("context");
      expect(JSON.stringify(report)).not.toContain("hunter2");
      expect(report.recordCount).toBe(3);
    });

    it("a tool that throws is reported as FAILURE and its own error is rethrown unchanged", async () => {
      authorizeQueue.push(allow());
      const boom = new Error("tool exploded");
      await expect(client().guard(request, () => Promise.reject(boom))).rejects.toBe(boom);
      expect(calls[1].body).toMatchObject({ status: "FAILURE", evaluationId: "eval_1" });
    });

    it("a failed report never changes the outcome, and is surfaced to onReportError only", async () => {
      authorizeQueue.push(allow());
      eventsHandler = () => json({ error: { code: "BOOM", message: "down" } }, 500);
      const onReportError = vi.fn();
      const tool = vi.fn(() => "done");
      expect(await client().guard({ ...request, onReportError }, tool)).toBe("done");
      expect(tool).toHaveBeenCalledTimes(1); // no retry that could run the tool twice
      expect(onReportError).toHaveBeenCalledTimes(1);
    });

    it("a throwing onReportError cannot change the outcome either", async () => {
      authorizeQueue.push(allow());
      eventsHandler = () => json({ error: { code: "BOOM", message: "down" } }, 500);
      expect(await client().guard({ ...request, onReportError: () => { throw new Error("callback bug"); } }, () => "ok")).toBe("ok");
    });
  });

  describe("the tool does NOT run", () => {
    it("on BLOCK: throws AegisBlockedError carrying the decision, and reports nothing (nothing executed)", async () => {
      authorizeQueue.push(block);
      const tool = vi.fn();
      const error = await client().guard(request, tool).catch((e) => e);
      expect(error).toBeInstanceOf(AegisBlockedError);
      expect(error.decision).toMatchObject({ decision: "BLOCK", evaluationId: "eval_b" });
      expect(error.message).toBe("Blocked by policy");
      expect(tool).not.toHaveBeenCalled();
      expect(paths()).toEqual(["/api/v1/evaluate"]);
    });

    it("on REQUIRE_APPROVAL (default): throws AegisApprovalRequiredError with the request id", async () => {
      authorizeQueue.push(needsApproval);
      const tool = vi.fn();
      const error = await client().guard(request, tool).catch((e) => e);
      expect(error).toBeInstanceOf(AegisApprovalRequiredError);
      expect(error.approvalRequestId).toBe("appr_1");
      expect(tool).not.toHaveBeenCalled();
      expect(paths()).toEqual(["/api/v1/evaluate"]);
    });

    it("when Aegis is unreachable: FAILS CLOSED by default", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
      const tool = vi.fn();
      const error = await client().guard(request, tool).catch((e) => e);
      expect(error).toBeInstanceOf(AegisUnavailableError);
      expect(error.message).toContain("fail closed");
      expect(tool).not.toHaveBeenCalled();
    });

    it("on a 5xx, a rate limit, or a timeout: also fails closed", async () => {
      for (const make of [() => json({ error: { code: "E", message: "x" } }, 503), () => json({ error: { code: "RATE_LIMITED", message: "slow" } }, 429)]) {
        authorizeQueue.push(make);
        const tool = vi.fn();
        await expect(client().guard(request, tool)).rejects.toBeInstanceOf(AegisUnavailableError);
        expect(tool).not.toHaveBeenCalled();
      }
      vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))));
      const tool = vi.fn();
      await expect(client().guard(request, tool)).rejects.toBeInstanceOf(AegisUnavailableError);
      expect(tool).not.toHaveBeenCalled();
    });

    it("a rejected request is a bug, not an outage: bad key / invalid payload / unknown agent / 403 NEVER proceed — even with onUnavailable: 'open'", async () => {
      const cases: [() => Response, new (...a: never[]) => Error][] = [
        [() => json({ error: { code: "INVALID_API_KEY", message: "bad key" } }, 401), AegisAuthenticationError],
        [() => json({ error: { code: "INVALID_REQUEST", message: "bad payload" } }, 400), AegisValidationError],
        [() => json({ error: { code: "AGENT_NOT_FOUND", message: "no agent" } }, 404), AegisValidationError],
        [() => json({ error: { code: "AGENT_NOT_AUTHORIZED", message: "bound to another agent" } }, 403), AegisApiError],
      ];
      for (const [make, errorClass] of cases) {
        authorizeQueue.push(make);
        const tool = vi.fn();
        await expect(client().guard({ ...request, onUnavailable: "open" }, tool)).rejects.toBeInstanceOf(errorClass);
        expect(tool, errorClass.name).not.toHaveBeenCalled();
      }
    });
  });

  describe("approvals", () => {
    it("onApproval 'wait': waits, then runs the tool exactly once under the single-use approval", async () => {
      authorizeQueue.push(needsApproval, allow({ evaluationId: "eval_2", decisionSource: "APPROVAL", consumedApprovalRequestId: "appr_1" }));
      approvalQueue.push(() => json({ id: "appr_1", status: "APPROVED", decision: "APPROVED", resolvedAt: "2026-10-09T10:00:00Z" }));
      const tool = vi.fn(() => "refunded");
      const result = await client().guard({ ...request, onApproval: "wait" }, tool);

      expect(result).toBe("refunded");
      expect(tool).toHaveBeenCalledTimes(1);
      expect(paths()).toEqual(["/api/v1/evaluate", "/api/v1/approvals/appr_1", "/api/v1/evaluate", "/api/v1/events"]);
      const [first, , second, report] = calls;
      expect(second.body).toMatchObject({ approvalRequestId: "appr_1", agent: "finance-agent", action: "refund.issue", resource: "order:42", context: { amount: 1250 } }); // the SAME request
      expect(first.headers["Idempotency-Key"]).not.toBe(second.headers["Idempotency-Key"]); // a fresh key: not a replay of the REQUIRE_APPROVAL answer
      expect(report.body.evaluationId).toBe("eval_2"); // the execution is linked to the decision that actually allowed it
    });

    it("a rejected approval throws and the tool does not run", async () => {
      authorizeQueue.push(needsApproval);
      approvalQueue.push(() => json({ id: "appr_1", status: "REJECTED", decision: "REJECTED", resolvedAt: "2026-10-09T10:00:00Z" }));
      const tool = vi.fn();
      const error = await client().guard({ ...request, onApproval: "wait" }, tool).catch((e) => e);
      expect(error).toBeInstanceOf(AegisBlockedError);
      expect(error.message).toContain("rejected");
      expect(tool).not.toHaveBeenCalled();
    });

    it("if the approval cannot be used (already spent / mismatch), the second authorize BLOCKs and the tool does not run", async () => {
      authorizeQueue.push(needsApproval, () => json({ decision: "BLOCK", evaluationId: "eval_x", traceId: "t", reason: "approval already used", approvalDenialCode: "APPROVAL_ALREADY_USED" }));
      approvalQueue.push(() => json({ id: "appr_1", status: "APPROVED", decision: "APPROVED", resolvedAt: "2026-10-09T10:00:00Z" }));
      const tool = vi.fn();
      await expect(client().guard({ ...request, onApproval: "wait" }, tool)).rejects.toBeInstanceOf(AegisBlockedError);
      expect(tool).not.toHaveBeenCalled();
    });
  });

  describe("onUnavailable: 'open' (explicit opt-in)", () => {
    it("runs the tool with a null decision and marks the report as unguarded", async () => {
      let n = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          const path = new URL(url).pathname;
          calls.push({ path, body: init.body ? JSON.parse(init.body as string) : {}, headers: {} });
          n += 1;
          if (path === "/api/v1/evaluate") throw new TypeError("fetch failed");
          return json({ id: "evt_u", traceId: "t" });
        })
      );
      const tool = vi.fn((d) => (d === null ? "ran unguarded" : "ran guarded"));
      expect(await client().guard({ ...request, onUnavailable: "open" }, tool)).toBe("ran unguarded");
      expect(tool).toHaveBeenCalledWith(null);
      const report = calls.find((c) => c.path === "/api/v1/events")!;
      expect(report.body.metadata).toMatchObject({ aegisUnavailable: true, unguarded: true });
      expect(report.body).not.toHaveProperty("evaluationId");
      expect(n).toBe(2);
    });
  });

  it("sends a trace id and an idempotency key on authorize, like authorize() itself", async () => {
    authorizeQueue.push(allow());
    await client().guard(request, () => 1);
    expect(calls[0].body.traceId).toMatch(/^trace_/);
    expect(calls[0].headers["Idempotency-Key"]).toMatch(/^idem_/);
  });
});
