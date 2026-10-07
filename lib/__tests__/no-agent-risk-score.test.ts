import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ATTENTION_FLAG_LABEL } from "@/lib/control/posture";

const read = (p: string) => readFileSync(resolve(p), "utf8");

/** Aegis does not reduce an agent's posture to a score or a risk label. (The Risk Scanner keeps its own, separate report score.) */
describe("Aegis has no generic agent Risk Score", () => {
  it("the score, its card and the risk meter no longer exist", () => {
    for (const gone of ["lib/security/risk-score.ts", "components/security/agent-risk-score.tsx", "components/console/risk-meter.tsx"]) {
      expect(existsSync(resolve(gone)), gone).toBe(false);
    }
  });

  const surfaces = [
    "app/(dashboard)/agents/[slug]/page.tsx", // agent detail
    "app/(dashboard)/agents/page.tsx", // Control Center
    "components/console/agent-node.tsx", // agent card
    "app/(dashboard)/control/page.tsx",
    "components/control/agent-control-view.tsx",
    "components/agents/connection/agent-protection-status.tsx",
    "components/agents/agent-connection-wizard.tsx",
  ];
  it.each(surfaces)("%s renders no risk score / meter / configured-risk label", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/risk score|RiskMeter|AgentRiskScore|getAgentRiskScore|Configured risk|Configured \{agent/i);
  });

  it("the Control Center has no derived 'high risk' attention flag", () => {
    expect(Object.keys(ATTENTION_FLAG_LABEL)).not.toContain("HIGH_RISK");
    expect(read("app/(dashboard)/control/page.tsx")).not.toMatch(/High risk|HIGH_RISK/);
  });

  it("the agent list can no longer be filtered by a risk label", () => {
    expect(read("components/agents/agent-filters.tsx")).not.toMatch(/riskLevel|risk levels/i);
  });

  it("the scanner UI shows no score either: the Free Risk Scanner is findings from a real agent", () => {
    expect(existsSync(resolve("components/scanner/report.tsx"))).toBe(false);
    expect(read("app/(dashboard)/risk-scan/page.tsx")).not.toMatch(/risk score|riskScore|\.score\b|\{[^}]*\bscore\b[^}]*\}|\/\s*100/i);
    expect(read("components/security/agent-scan-panel.tsx")).not.toMatch(/risk score|riskScore|\.score\b|\{[^}]*\bscore\b[^}]*\}|\/\s*100/i);
  });
});
