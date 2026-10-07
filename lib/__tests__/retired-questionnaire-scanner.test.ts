import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GET as apiGet, POST as apiPost } from "@/app/api/scan/route";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

/** The questionnaire scanner (a self-assessment that produced a score) is retired; the Free Risk Scanner scans real agents. */
describe("the questionnaire scanner is retired", () => {
  it("none of its pages, shared reports, wizard or report UI exist any more", () => {
    for (const gone of [
      "app/(scanner)/scan/report",
      "app/(scanner)/scan/r",
      "app/(scanner)/scan/connect",
      "app/(dashboard)/risk-scan/[id]",
      "app/api/scan/events",
      "app/api/scan/[id]",
      "components/scanner/scanner-wizard.tsx",
      "components/scanner/report.tsx",
      "components/scanner/conversion-panel.tsx",
      "components/scanner/share-panel.tsx",
      "components/scanner/severity.tsx",
    ]) {
      expect(existsSync(resolve(gone)), gone).toBe(false);
    }
  });

  it("old URLs redirect to the Free Risk Scanner entry point, never to a score", () => {
    const config = read("next.config.ts");
    for (const rule of [`source: "/scan/:path+", destination: "/scan"`, `source: "/risk", destination: "/scan"`, `source: "/risk-scan/:path+", destination: "/risk-scan"`]) {
      expect(config).toContain(rule);
    }
  });

  it("the old scan API creates and returns nothing: 410 Gone, with no score", async () => {
    for (const handler of [apiGet, apiPost]) {
      const res = await handler();
      expect(res.status).toBe(410);
      const body = JSON.stringify(await res.json());
      expect(body).toContain("GONE");
      expect(body).not.toMatch(/score|level|reportUrl/i);
    }
  });

  it("the public /scan page is a real-agent explainer: no questionnaire, no score, no safety claim", () => {
    const page = strip(read("app/(scanner)/scan/page.tsx"));
    expect(page).not.toMatch(/ScannerWizard|\/api\/scan/);
    expect(page).not.toMatch(/risk score|riskScore|\.score\b|\{[^}]*\bscore\b[^}]*\}|\/\s*100/i);
    expect(page).toContain("Connect Agent");
    expect(page).toContain("Free Risk Scanner");
    expect(page).toMatch(/does not test your agent.{1,8}s prompts, source code or model behavior/);
    expect(page).not.toMatch(/\b(safe|secure|protected)\b/i);
  });

  it("the signed-in Free Risk Scanner uses the real-agent Scan Agent and nothing from the questionnaire", () => {
    const page = strip(read("app/(dashboard)/risk-scan/page.tsx"));
    expect(page).toContain("listScanTargets");
    expect(page).toContain("AgentScanPanel");
    expect(page).toContain("Connect Agent");
    expect(page).not.toMatch(/listOrganizationScans|getOrganizationScan|diffScans|LevelBadge|agentTypeLabel|ScanReport/);
    expect(page).not.toMatch(/risk score|riskScore|\.score\b|\{[^}]*\bscore\b[^}]*\}|\/\s*100/i);
    expect(page).not.toMatch(/configured risk|RiskMeter/i);
  });

  it("the dashboard routes the scanner entry points to the new scanner", () => {
    expect(read("app/(dashboard)/agents/page.tsx")).not.toContain("/scan?from=dashboard");
    expect(read("lib/dashboard-nav.ts")).toContain('label: "Free Risk Scanner"');
    expect(read("components/dashboard/primary-nav.tsx")).toContain("Free Risk Scanner");
    expect(read("components/marketing/nav.tsx")).toContain("Free Risk Scanner");
  });
});
