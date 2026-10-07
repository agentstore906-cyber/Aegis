import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentScanPanel } from "@/components/security/agent-scan-panel";
import { buildAgentScan, scanEligibility, type EndpointEvidence, type ScanEvidence } from "@/lib/scanner/agent-scan-model";

// The server action pulls in the auth stack; the panel only needs it to exist.
vi.mock("@/lib/scanner/agent-scan-actions", () => ({ runAgentScanAction: async () => ({ ok: true }) }));

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const evidence: ScanEvidence = {
  connection: { firstHandshakeAt: new Date("2026-10-07T10:00:00Z"), lastSeenAt: new Date("2026-10-07T10:05:00Z") },
  identity: { assurance: "ORG_WIDE_ONLY", boundKeys: 0, orgWideKeys: 1 },
  access: { allow: 1, alert: 0, requireApproval: 0, block: 0, total: 1, broadGrants: 1 },
  coverage: { reportedActions: 4, decided: 0, undecided: 4, ranDespite: 0, decisionRequests: 0, coverage: 0, windowDays: 7 },
  activityEvents7d: 4,
  deviations7d: 0,
  openIncidents: 0,
  pendingApprovals: 0,
  unusedGrants: 0,
  activePolicies: 1,
  keysWithoutExpiry: 1,
  openAlerts: {},
};
const rejected = { outcome: "rejected" as const, status: 401, detail: "refused with HTTP 401" };
const endpoint = (over: Partial<EndpointEvidence> = {}): EndpointEvidence => ({
  endpointHost: "agent.example.com",
  usesTls: true,
  agentName: "Support",
  manifest: { framework: "x", model: "y", tools: [{ name: "files.delete", access: "destructive" }, { name: "calendar.sync", access: null }], humanApproval: false },
  probes: { unsigned: rejected, wrongSignature: rejected, stale: rejected },
  ...over,
});

describe("agent scan: eligibility", () => {
  it("only an agent Aegis connected to through its endpoint, and last saw connected, can be scanned", () => {
    const at = new Date();
    expect(scanEligibility({ state: "CONNECTED", connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: at }).ok).toBe(true);
    // verified before but not in the last day: allowed, because the scan itself re-verifies live
    expect(scanEligibility({ state: "NOT_SEEN_RECENTLY", connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: at }).ok).toBe(true);
    for (const state of ["WAITING", "CREDENTIAL_VERIFIED", "REVOKED", "ERROR"]) expect(scanEligibility({ state, connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: at }).ok, state).toBe(false);
    expect(scanEligibility({ state: "CONNECTED", connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: null }).ok).toBe(false);
  });

  it("an agent connected any other way, or a record that was never verified, is refused with 'Connect an AI agent first'", () => {
    for (const connectorType of ["CUSTOM_SDK", "OPENAI", "ANTHROPIC", null]) {
      const e = scanEligibility({ state: "CONNECTED", connectorType, firstHandshakeAt: new Date() });
      expect(e.ok, String(connectorType)).toBe(false);
      expect(!e.ok && e.message).toMatch(/connect an ai agent first/i);
    }
    const waiting = scanEligibility({ state: "WAITING", connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: null });
    expect(!waiting.ok && waiting.message).toBe("Connect an AI agent first.");
    for (const state of ["WAITING", "CREDENTIAL_VERIFIED", "REVOKED", "ERROR"]) {
      const r = scanEligibility({ state, connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: null });
      expect(!r.ok && r.message, state).not.toMatch(/waiting for (your|the) (ai )?agent/i);
    }
  });
});

describe("agent scan panel", () => {
  it("when it cannot scan, says to connect an agent first, offers a disabled button and shows no findings", () => {
    const blocked = scanEligibility({ state: "WAITING", connectorType: null, firstHandshakeAt: null });
    const out = text(<AgentScanPanel slug="a" canScan blockedReason={blocked.ok ? null : blocked.message} scan={null} />);
    expect(out).toMatch(/Connect an AI agent first/);
    expect(out).not.toMatch(/waiting for (your|the) (ai )?agent/i);
    expect(out).not.toMatch(/Security findings/);
    expect(renderToStaticMarkup(<AgentScanPanel slug="a" canScan blockedReason="x" scan={null} />)).toMatch(/disabled/);
  });

  it("shows findings labelled observed/tested, the tests made against the agent, and an explicit 'Not tested' list", () => {
    const result = buildAgentScan(evidence, [{ action: "shell.exec", label: "run shell commands", critical: true, decision: "ALLOW", decisionSource: "PERMISSION", reason: "r" }], endpoint());
    const out = text(<AgentScanPanel slug="a" canScan blockedReason={null} scan={{ createdAtIso: "2026-10-07T10:10:00Z", result }} />);
    expect(out).toContain("Security findings");
    expect(out).toContain("Sensitive actions would be allowed without approval");
    expect(out).toMatch(/tested/);
    expect(out).toMatch(/observed/);
    expect(out).toContain("Tested against the agent");
    expect(out).toContain("Refuses a request with no signature");
    expect(out).toContain("Not tested");
    expect(out).toMatch(/does not test the agent.{1,6}s prompts, source code or model behavior/);
    expect(out).toContain("calendar.sync"); // declared without an access level: listed as not assessed
    expect(out).not.toMatch(/risk score|\d+\s*\/\s*100|\b(safe|secure|protected)\b/i);
  });

  it("a check that could not be made is shown as not tested, never as passed", () => {
    const result = buildAgentScan(evidence, [], endpoint({ probes: { unsigned: { outcome: "inconclusive", status: 500, detail: "answered HTTP 500" }, wrongSignature: rejected, stale: rejected } }));
    const t = result.endpointTests.find((x) => x.id === "unsigned_rejected")!;
    expect(t.outcome).toBe("not_tested");
    expect(result.notTested.map((n) => n.id)).toContain("endpoint:unsigned_rejected");
    const out = text(<AgentScanPanel slug="a" canScan blockedReason={null} scan={{ createdAtIso: "2026-10-07T10:10:00Z", result }} />);
    expect(out).toMatch(/Refuses a request with no signature\s*: not tested/);
  });

  it("with nothing found it does not claim the agent is safe", () => {
    const result = buildAgentScan(
      { ...evidence, access: { ...evidence.access, broadGrants: 0 }, activityEvents7d: 0, coverage: { ...evidence.coverage, reportedActions: 0, coverage: null }, identity: { assurance: "ISOLATED", boundKeys: 1, orgWideKeys: 0 }, keysWithoutExpiry: 0 },
      [],
      endpoint({ manifest: { framework: null, model: null, tools: [], humanApproval: true } })
    );
    const out = text(<AgentScanPanel slug="a" canScan blockedReason={null} scan={{ createdAtIso: "2026-10-07T10:10:00Z", result }} />);
    expect(result.findings).toEqual([]);
    expect(out).toMatch(/does not describe the parts of the agent Aegis cannot see/);
    expect(out).not.toMatch(/\b(safe|secure|protected)\b/i);
  });
});
