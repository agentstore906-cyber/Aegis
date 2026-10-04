import { describe, expect, it } from "vitest";

import { runRiskEngine } from "@/lib/scanner/engine";
import { shareText, shareTitle, toPublicReport } from "@/lib/scanner/share";
import { canView, diffScans } from "@/lib/scanner/service";
import { controlsForCategories, AEGIS_CONTROLS } from "@/lib/scanner/aegis-controls";
import { RISK_CATEGORIES, type ScanInput } from "@/lib/scanner/types";
import {
  draftForStorage,
  emptyDraft,
  relevantControls,
  stepForField,
  stepProblem,
  toRequestBody,
  toggleAutonomy,
} from "@/lib/scanner/wizard-model";

const input: ScanInput = {
  agentType: "other",
  agentLabel: "ACME-CORP-CANARY internal payroll bot",
  capabilities: ["financial_data", "execute_transactions", "credentials_secrets", "send_emails"],
  autonomy: ["autonomous"],
  controls: { approval_gates: "not_in_place" },
  advancedText: null,
};

const row = (over: Record<string, unknown> = {}) => ({
  publicSlug: "AbCdEfGhIjKl",
  isPublic: true,
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  expiresAt: new Date(Date.now() + 86_400_000),
  agentType: "other",
  result: runRiskEngine(input),
  ...over,
});

describe("public report projection", () => {
  it("exposes only score, level, counts, finding titles/severities and one recommendation each", () => {
    const report = toPublicReport(row())!;
    expect(Object.keys(report).sort()).toEqual(["agentTypeLabel", "counts", "engineVersion", "findings", "level", "publishedAt", "score", "slug"]);
    for (const f of report.findings) expect(Object.keys(f).sort()).toEqual(["recommendation", "severity", "title"]);
  });

  it("never contains the custom agent label, evidence text, pasted signals, or ids", () => {
    const json = JSON.stringify(toPublicReport(row()));
    expect(json).not.toContain("ACME-CORP-CANARY");
    expect(json).not.toMatch(/You selected|Observed|inferred|userId|organizationId|sessionHash|agentLabel|connectedAgentId/i);
    expect(toPublicReport(row())!.agentTypeLabel).toBe("AI agent"); // "other" is never named publicly
  });

  it("returns null for private, unpublished, expired or corrupt rows (fails closed)", () => {
    expect(toPublicReport(row({ isPublic: false }))).toBeNull();
    expect(toPublicReport(row({ publicSlug: null }))).toBeNull();
    expect(toPublicReport(row({ publishedAt: null }))).toBeNull();
    expect(toPublicReport(row({ expiresAt: new Date(Date.now() - 1000) }))).toBeNull();
    expect(toPublicReport(row({ result: { nonsense: true } }))).toBeNull();
    expect(toPublicReport(row({ result: null }))).toBeNull();
  });

  it("shares the score and high-risk count in the suggested copy", () => {
    expect(shareTitle(72)).toBe("My AI Agent Security Score: 72/100");
    expect(shareText({ high: 4 }, 72)).toContain("found 4 high-risk behaviors");
    expect(shareText({ high: 1 }, 40)).toContain("1 high-risk behavior ");
    expect(shareText({ high: 0 }, 5)).toContain("no high-risk behaviors");
  });
});

describe("scan ownership", () => {
  const anon = { sessionHash: "hash-a", userId: null, organizationId: null };
  it("lets the creating browser session view an unclaimed scan, and nobody else", () => {
    expect(canView(anon, { sessionHash: "hash-a" })).toBe(true);
    expect(canView(anon, { sessionHash: "hash-b" })).toBe(false);
    expect(canView(anon, {})).toBe(false);
    expect(canView({ ...anon, sessionHash: null }, { sessionHash: null })).toBe(false);
  });

  it("after a claim, the old session alone is not enough — only the owner or an organization member", () => {
    const claimed = { sessionHash: "hash-a", userId: "u1", organizationId: "o1" };
    expect(canView(claimed, { sessionHash: "hash-a" })).toBe(false);
    expect(canView(claimed, { sessionHash: "hash-a", userId: "u2" })).toBe(false);
    expect(canView(claimed, { userId: "u1" })).toBe(true);
    expect(canView(claimed, { userId: "u2", organizationIds: ["o1"] })).toBe(true);
    expect(canView(claimed, { userId: "u2", organizationIds: ["o2"] })).toBe(false);
  });
});

describe("trend between scans", () => {
  it("reports resolved, improved, introduced and unresolved findings", () => {
    const before = runRiskEngine({ ...input, agentType: "finance", agentLabel: null, controls: {} });
    const after = runRiskEngine({ ...input, agentType: "finance", agentLabel: null, capabilities: ["financial_data", "send_emails"], autonomy: ["with_approval"], controls: { approval_gates: "in_place", human_in_loop: "in_place" } });
    const diff = diffScans(before, after);
    expect(diff.resolved.length).toBeGreaterThan(0);
    expect(diff.unresolved).toEqual(after.findings);
    expect(after.score).toBeLessThan(before.score);
    expect(diffScans(null, after).resolved).toEqual([]);
    expect(diffScans(null, after).introduced).toEqual([]);
  });
});

describe("Aegis control mapping stays honest", () => {
  it("maps every category to at least one control", () => {
    for (const c of RISK_CATEGORIES) expect(controlsForCategories([c]).length).toBeGreaterThan(0);
  });

  it("never links a control that isn't shipped, and never marks an unbuilt one available", () => {
    for (const control of Object.values(AEGIS_CONTROLS) as { id: string; status: string; href?: string }[]) {
      if (control.status === "coming_soon" || control.status === "not_provided") expect(control.href).toBeUndefined();
    }
    expect(AEGIS_CONTROLS.credential_brokering.status).toBe("coming_soon");
  });

  it("lists shipped controls before coming-soon ones", () => {
    const list = controlsForCategories(["weak_secrets_isolation", "excessive_permissions"]);
    const firstUnbuilt = list.findIndex((c) => c.status === "coming_soon");
    expect(list.slice(0, firstUnbuilt).every((c) => c.status === "available" || c.status === "partial")).toBe(true);
  });
});

describe("wizard model", () => {
  it("blocks progress until required answers exist, but allows an empty capability list", () => {
    const d = emptyDraft();
    expect(stepProblem("type", d)).toMatch(/choose/i);
    expect(stepProblem("capabilities", d)).toBeNull();
    expect(stepProblem("autonomy", d)).toMatch(/choose/i);
    expect(stepProblem("type", { ...d, agentType: "other" })).toMatch(/few words/i);
    expect(stepProblem("type", { ...d, agentType: "other", agentLabel: "Bot" })).toBeNull();
  });

  it("makes 'Read only' exclusive of every other autonomy level", () => {
    expect(toggleAutonomy(["autonomous"], "read_only")).toEqual(["read_only"]);
    expect(toggleAutonomy(["read_only"], "autonomous")).toEqual(["autonomous"]);
    expect(toggleAutonomy(["suggest"], "with_approval")).toEqual(["suggest", "with_approval"]);
    expect(toggleAutonomy(["suggest", "with_approval"], "suggest")).toEqual(["with_approval"]);
  });

  it("adapts which controls are flagged relevant to what the agent can do", () => {
    expect(relevantControls({ capabilities: ["shell"], autonomy: ["autonomous"] })).toContain("sandboxing");
    expect(relevantControls({ capabilities: ["web_browsing"], autonomy: ["read_only"] })).not.toContain("sandboxing");
    expect(relevantControls({ capabilities: ["send_emails"], autonomy: ["autonomous"] })).toEqual(expect.arrayContaining(["approval_gates", "rate_limits"]));
  });

  it("builds the request body without empty optional fields and keeps the label only for 'other'", () => {
    const d = { ...emptyDraft(), agentType: "coding" as const, agentLabel: "ignored", autonomy: ["suggest" as const], advancedText: "   " };
    expect(toRequestBody(d)).toMatchObject({ agentLabel: null, advancedText: null });
    expect(toRequestBody({ ...d, agentType: "other", agentLabel: " Bot " }).agentLabel).toBe("Bot");
  });

  it("never persists pasted text in browser storage", () => {
    const stored = JSON.stringify(draftForStorage({ ...emptyDraft(), advancedText: "PASTED_SECRET_CANARY" }, 3));
    expect(stored).not.toContain("PASTED_SECRET_CANARY");
    expect(stored).not.toContain("advancedText");
  });

  it("routes API field errors to the step that owns them", () => {
    expect(stepForField("agentType")).toBe("type");
    expect(stepForField("autonomy")).toBe("autonomy");
    expect(stepForField("advancedText")).toBe("advanced");
  });
});
