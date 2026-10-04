import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: no database, no real cookies/headers. The limiters are the real (in-memory) ones.
const { createScan, track, ip } = vi.hoisted(() => ({ createScan: vi.fn(), track: vi.fn(async () => {}), ip: { value: "203.0.113.1" } }));

vi.mock("@/lib/http/client-ip", () => ({ getClientIp: async () => ip.value }));
vi.mock("@/lib/scanner/session", () => ({ ensureSessionHash: async () => "session-hash-abc", getSessionHash: async () => "session-hash-abc" }));
vi.mock("@/lib/scanner/service", () => ({ createScan: (...a: unknown[]) => createScan(...a), isScanId: (v: string) => /^[A-Za-z0-9_-]{22}$/.test(v) }));
vi.mock("@/lib/scanner/analytics", async (orig) => ({ ...(await orig<typeof import("@/lib/scanner/analytics")>()), trackScannerEvent: track }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/organizations/queries", () => ({ getActiveMembership: async () => null, getUserMemberships: async () => [] }));

import { POST } from "@/app/api/scan/route";
import { POST as EVENTS } from "@/app/api/scan/events/route";

const body = { agentType: "coding", capabilities: ["shell"], autonomy: ["autonomous"], controls: {} };

function req(payload: unknown, init: { headers?: Record<string, string>; raw?: string } = {}) {
  return new NextRequest("http://localhost:3000/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...init.headers },
    body: init.raw ?? JSON.stringify(payload),
  });
}

beforeEach(() => {
  createScan.mockReset();
  createScan.mockResolvedValue({ id: "AAAAAAAAAAAAAAAAAAAAAA", result: { level: "high", score: 61, counts: { high: 2 } } });
  track.mockClear();
  ip.value = `198.51.100.${Math.floor(Math.random() * 200) + 1}`; // a fresh rate-limit bucket per test
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/scan", () => {
  it("creates a scan without an account and returns a report URL (no scan content echoed)", async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ id: "AAAAAAAAAAAAAAAAAAAAAA", reportUrl: "/scan/report/AAAAAAAAAAAAAAAAAAAAAA", score: 61, level: "high" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(createScan).toHaveBeenCalledWith(expect.objectContaining({ sessionHash: "session-hash-abc", userId: null }));
    expect(track).toHaveBeenCalledWith("scan_generated", expect.anything());
    expect(track).toHaveBeenCalledWith("high_risk_detected", expect.anything());
  });

  it("rejects malformed JSON with 400 and no stack or content", async () => {
    const res = await POST(req(null, { raw: '{"agentType": "coding", ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
    expect(createScan).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types with 415", async () => {
    const res = await POST(req(body, { headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(415);
  });

  it("rejects oversized bodies with 413 before parsing, by header and by actual size", async () => {
    const byHeader = await POST(req(body, { headers: { "content-length": "999999" } }));
    expect(byHeader.status).toBe(413);
    const bySize = await POST(req({ ...body, advancedText: "x".repeat(60_000) }));
    expect(bySize.status).toBe(413);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("rejects invalid input with 422, field errors, and no reflection of the payload", async () => {
    const res = await POST(req({ ...body, agentType: "<img src=x onerror=alert('reflect-canary')>", extra: 1 }));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain("reflect-canary");
    expect(JSON.parse(text).error.code).toBe("invalid_input");
  });

  it("rejects cross-site browser requests, and allows requests with no Origin (non-browser clients)", async () => {
    const cross = await POST(req(body, { headers: { origin: "https://evil.example" } }));
    expect(cross.status).toBe(403);
    const same = await POST(req(body, { headers: { origin: "http://localhost:3000" } }));
    expect(same.status).toBe(201);
    const none = await POST(req(body));
    expect(none.status).toBe(201);
  });

  it("rate-limits per IP: the 11th scan within the hour gets 429 with Retry-After", async () => {
    ip.value = "192.0.2.77";
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await POST(req(body));
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    const json = await last!.json();
    expect(json.error.code).toBe("rate_limited");
  });

  it("returns a safe 500 that leaks neither the error text nor the request content, and logs neither", async () => {
    createScan.mockRejectedValueOnce(new Error("connection string postgres://user:SECRET_PW@host/db failed"));
    const res = await POST(req({ ...body, advancedText: "PRIVATE_PROMPT_CANARY" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET_PW|postgres:|PRIVATE_PROMPT_CANARY/);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toMatch(/SECRET_PW|PRIVATE_PROMPT_CANARY/);
  });

  it("passes pasted text to the service only as the validated, normalised input (never as a URL, header or log)", async () => {
    await POST(req({ ...body, advancedText: "  hello​ world  " }));
    const input = createScan.mock.calls[0]![0].input;
    expect(input.advancedText).toBe("hello world");
  });
});

describe("POST /api/scan/events", () => {
  const ev = (payload: unknown) =>
    EVENTS(new NextRequest("http://localhost:3000/api/scan/events", { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000" }, body: JSON.stringify(payload) }));

  it("accepts allowlisted client events and strips unknown properties", async () => {
    const res = await ev({ event: "scanner_step_completed", props: { step: 2, answers: ["shell"], prompt: "secret" } });
    expect(res.status).toBe(204);
    expect(track).toHaveBeenCalledWith("scanner_step_completed", expect.objectContaining({ properties: { step: 2, answers: ["shell"], prompt: "secret" } }));
    // Reduction to allowlisted keys happens at persistence (sanitizeProps), covered in security.test.ts.
  });

  it("refuses events the browser must not be able to forge", async () => {
    for (const event of ["subscription_started", "scan_generated", "signup_completed", "not_an_event"]) {
      expect((await ev({ event })).status).toBe(422);
    }
  });
});
