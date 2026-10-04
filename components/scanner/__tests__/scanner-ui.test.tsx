import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/scanner/actions", () => ({ linkScanToAgentAction: vi.fn() }));

import { Hero } from "@/components/marketing/hero";
import { AegisSetup } from "@/components/scanner/aegis-setup";
import { ConversionPanel } from "@/components/scanner/conversion-panel";
import { ScanReport } from "@/components/scanner/report";
import { ScannerWizard } from "@/components/scanner/scanner-wizard";
import { SharePanel } from "@/components/scanner/share-panel";
import { runRiskEngine } from "@/lib/scanner/engine";
import type { ScanInput } from "@/lib/scanner/types";

const risky: ScanInput = {
  agentType: "support",
  agentLabel: null,
  capabilities: ["customer_data", "email", "send_emails", "credentials_secrets", "shell", "web_browsing"],
  autonomy: ["autonomous"],
  controls: { audit_logs: "in_place" },
  advancedText: null,
};

describe("<ScannerWizard>", () => {
  it("starts on step 1 with every agent type, a progress indicator, and no network or account prompt", () => {
    const html = renderToStaticMarkup(<ScannerWizard />);
    expect(html).toContain("What kind of AI agent are you securing?");
    for (const label of ["Coding agent", "Customer support agent", "Research agent", "Sales agent", "Finance agent", "Internal company agent", "Browser agent", "Autonomous workflow agent", "Other"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Step 1 of 5");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("No account needed");
    expect(html).not.toMatch(/sign up|password/i);
  });

  it("uses single-column cards on mobile and two columns from the sm breakpoint, with no fixed widths", () => {
    const html = renderToStaticMarkup(<ScannerWizard />);
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toMatch(/min-h-14/); // comfortable touch targets
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]/);
  });

  it("renders choices as real radio inputs inside a labelled fieldset (keyboard and screen-reader accessible)", () => {
    const html = renderToStaticMarkup(<ScannerWizard />);
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
  });
});

describe("<ScanReport>", () => {
  const result = runRiskEngine(risky);
  const html = renderToStaticMarkup(<ScanReport result={result} agentLabel="Customer support agent" createdAt={new Date("2026-10-04T00:00:00Z")} />);

  it("presents the overall score, level and the high / medium / protected summary", () => {
    expect(html).toContain("Your AI Agent Security Report");
    expect(html).toContain(`Overall risk ${result.score} out of 100`);
    expect(html).toContain("High-risk behaviors");
    expect(html).toContain("Medium-risk behaviors");
    expect(html).toContain("Protected areas");
    expect(html).toContain("Top risks");
    expect(html).toContain("Security breakdown");
    expect(html).toContain("What to fix first");
  });

  it("separates observed configuration from inferred risk and recommended mitigation", () => {
    // Reading untrusted content is inferred from the agent type here (no web/email capability selected).
    const inferred = runRiskEngine({ ...risky, capabilities: ["customer_data", "send_emails"] });
    const inferredHtml = renderToStaticMarkup(<ScanReport result={inferred} agentLabel="Customer support agent" createdAt={new Date()} />);
    expect(inferredHtml).toContain("Inferred");
    expect(html).toContain("Observed");
    expect(html).toContain("Why it matters");
    expect(html).toContain("Potential impact");
    expect(html).toContain("Recommended mitigation");
  });

  it("states what Aegis can and cannot do, labelling unbuilt controls", () => {
    expect(html).toContain("Coming soon");
    expect(html).toContain("Outside Aegis");
    expect(html).toMatch(/Aegis · /);
  });

  it("never makes absolute security claims", () => {
    // The fixed disclaimer is the one place that may say "is or is not secure" — as a negation.
    const withoutDisclaimer = html.replace(result.disclaimer, "");
    expect(withoutDisclaimer).not.toMatch(/your agent is (secure|vulnerable|safe)|is not secure|100% secure|guaranteed/i);
    expect(html).toContain("not a penetration test");
  });

  it("escapes a hostile agent label instead of rendering it as markup", () => {
    const evil = renderToStaticMarkup(<ScanReport result={result} agentLabel={'<img src=x onerror=alert(1)><script>alert(2)</script>'} createdAt={new Date()} />);
    expect(evil).not.toContain("<img src=x");
    expect(evil).not.toContain("<script>alert");
    expect(evil).toContain("&lt;img");
  });

  it("uses text, not colour alone, for risk levels in the breakdown", () => {
    expect(html).toMatch(/role="img" aria-label="[^"]+: (Low|Moderate|High|Critical|no elevated risk indicated)"/);
  });

  it("renders a useful state when nothing elevated is indicated", () => {
    const calm = runRiskEngine({ ...risky, agentType: "internal", capabilities: [], autonomy: ["read_only"] });
    const calmHtml = renderToStaticMarkup(<ScanReport result={calm} agentLabel="Internal" createdAt={new Date()} />);
    expect(calmHtml).toContain("not a guarantee");
    expect(calmHtml).not.toContain("Findings</h2>");
  });
});

describe("conversion and sharing", () => {
  it("introduces Aegis after the report with the finding count, a primary CTA and a report link", () => {
    const html = renderToStaticMarkup(<ConversionPanel scanId="AAAAAAAAAAAAAAAAAAAAAA" highRisk={4} mediumRisk={3} />);
    expect(html).toContain("Your agent has 4 high-risk behaviors.");
    expect(html).toContain("A scan tells you what is risky. Aegis helps you continuously monitor and control it.");
    expect(html).toContain("Connect your agent to Aegis");
    expect(html).toContain('href="/scan/connect/AAAAAAAAAAAAAAAAAAAAAA"');
    expect(html).toContain("Explore my risk report");
    expect(html).toContain('href="#findings"');
    expect(renderToStaticMarkup(<ConversionPanel scanId="AAAAAAAAAAAAAAAAAAAAAA" highRisk={1} mediumRisk={0} />)).toContain("1 high-risk behavior.");
  });

  it("makes sharing optional and states exactly what becomes public", () => {
    const html = renderToStaticMarkup(<SharePanel scanId="AAAAAAAAAAAAAAAAAAAAAA" score={72} highRisk={4} initialPath={null} />);
    expect(html).toContain("My AI Agent Security Score: 72/100");
    expect(html).toContain("optional");
    expect(html).toMatch(/never your answers, evidence, pasted content or agent details/);
    expect(html).toContain("Create a public link");
  });

  it("lists detected risks and maps them to controls with honest status in the Aegis setup", () => {
    const html = renderToStaticMarkup(<AegisSetup result={runRiskEngine(risky)} />);
    expect(html).toContain("Your Aegis security setup".replace("Aegis security", "Aegis security"));
    expect(html).toContain("Detected risks");
    expect(html).toContain("Recommended Aegis controls");
    expect(html).toContain("Credential brokering for high-value tools");
    expect(html).toContain("Coming soon");
    // An unbuilt control is never rendered as a link.
    expect(html).not.toMatch(/<a [^>]*>Credential brokering/);
  });
});

describe("homepage entry point", () => {
  it("makes the scanner the primary hero CTA and demotes sign-up to secondary", () => {
    const html = renderToStaticMarkup(<Hero />);
    const scanIdx = html.indexOf("Scan your AI agent in 60 seconds");
    expect(scanIdx).toBeGreaterThan(-1);
    expect(html).toMatch(/href="\/scan"[^>]*>Scan your AI agent in 60 seconds/);
    expect(html).not.toMatch(/>Sign up for Aegis</);
    expect(html.indexOf('href="/scan"')).toBeLessThan(html.indexOf('href="/sign-up"'));
  });
});
