import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PlugZap } from "lucide-react";

import { ActivityFeed, EmptyAgents, QuickActions, StatusRail, UpgradeCta } from "@/components/console/control-overview";
import type { ActivityItem } from "@/lib/overview/security-activity";

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Aegis Control — empty state", () => {
  it("shows no agents and no data: the next step, and an honest scanner CTA", () => {
    const out = text(<EmptyAgents canManage canScan />);
    expect(out).toContain("Connect your first AI agent");
    expect(out).toContain("Bring a real AI agent into Aegis to monitor and control it from one place.");
    expect(out).toContain("Connect Agent");
    expect(out).toContain("Connect an agent to start scanning"); // the scanner needs a connected agent: said, not pretended
    expect(out).not.toMatch(/waiting for (your|the) (ai )?agent/i);
    expect(out).not.toMatch(/\b\d+ agents?\b/i);
  });

  it("without permission to connect, says who can; without security access, offers no scanner", () => {
    const out = text(<EmptyAgents canManage={false} canScan={false} />);
    expect(out).toContain("Ask an owner or admin to connect an agent.");
    expect(out).not.toContain("start scanning");
    expect(renderToStaticMarkup(<EmptyAgents canManage={false} canScan={false} />)).not.toContain('href="/agents/new"');
  });
});

describe("Aegis Control — Upgrade", () => {
  it("is the existing upgrade link, labelled Upgrade, with no price or saving", () => {
    const html = renderToStaticMarkup(<UpgradeCta />);
    expect(html).toContain('href="/upgrade"');
    expect(text(<UpgradeCta />).trim()).toBe("Upgrade Unlock advanced agent controls");
    expect(html).not.toMatch(/\$|%|save|off\b/i);
  });

  it("the top bar keeps the same link and the same audience (billing viewers)", () => {
    const bar = read("components/dashboard/topbar.tsx");
    expect(bar).toContain('href="/upgrade"');
    expect(bar).toMatch(/canViewBilling\(role\) && \(/);
  });
});

describe("Aegis Control — figures", () => {
  it("shows zero as zero, unavailable as a dash, and invents nothing", () => {
    const out = text(<StatusRail figures={[{ label: "Agents", value: 0 }, { label: "Connected", value: null }, { label: "Open alerts", value: 2, href: "/security", attention: true }]} />);
    expect(out).toMatch(/Agents 0/);
    expect(out).toMatch(/Connected —/);
    expect(out).toMatch(/Open alerts 2/);
  });
});

describe("Aegis Control — security activity", () => {
  const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({ id: "alert:1", at: new Date(Date.now() - 120_000), kind: "alert", title: "New destination", detail: "Support · high severity · open", href: "/security/1", tone: "danger", ...over });

  it("says there is none rather than inventing some", () => {
    const out = text(<ActivityFeed items={[]} />);
    expect(out).toContain("No security activity yet.");
    expect(out).not.toMatch(/\b\d+ (minutes?|hours?) ago\b/);
  });

  it("lists real events with their time and a link to the record", () => {
    const html = renderToStaticMarkup(<ActivityFeed items={[item()]} />);
    expect(html).toContain('href="/security/1"');
    expect(text(<ActivityFeed items={[item()]} />)).toContain("New destination");
    expect(text(<ActivityFeed items={[item()]} />)).toMatch(/2 minutes ago/);
  });
});

describe("Aegis Control — quick actions", () => {
  it("renders exactly the actions it is given", () => {
    const out = text(<QuickActions actions={[{ key: "connect", href: "/agents/new", title: "Connect Agent", description: "Bring a real agent into Aegis.", icon: PlugZap }]} />);
    expect(out).toContain("Connect Agent");
    expect(out).not.toContain("Upgrade");
  });
});

describe("Aegis Control — the page", () => {
  const page = read("app/(dashboard)/agents/page.tsx");

  it("is named Aegis Control, with the specified hero copy", () => {
    expect(page).toContain('title: "Aegis Control"');
    expect(page).toContain("Aegis Control</h1>");
    expect(page).toContain("Your security command layer for AI agents.");
    expect(page).toContain("AI agent security");
    expect(page).toContain("Control every agent with confidence.");
    expect(page).toContain("Connect your AI agents, monitor their security posture, and enforce control from one place.");
    expect(page).not.toMatch(/Command Center|AI Control Center/);
  });

  it("only ever shows the Upgrade call to action to the audience that sees it in the top bar", () => {
    expect(page).toMatch(/const showUpgrade = canViewBilling\(role\)/);
    expect(page).toMatch(/\{showUpgrade && <UpgradeCta/);
  });

  it("has no score, meter, configured risk, demo data, safety claim or waiting state", () => {
    for (const file of ["app/(dashboard)/agents/page.tsx", "components/console/control-overview.tsx", "components/console/agent-node.tsx", "lib/overview/security-activity.ts"]) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/risk score|riskScore|RiskMeter|Configured risk|demo agent|sample agent|mock/i);
      expect(src, file).not.toMatch(/waiting for (your|the) (ai )?agent/i);
    }
  });

  it("navigation uses the new name", () => {
    expect(read("components/dashboard/primary-nav.tsx")).toContain('label: "Aegis Control"');
    expect(read("lib/dashboard-nav.ts")).toContain('label: "Aegis Control"');
    expect(existsSync(resolve("app/(dashboard)/agents/loading.tsx"))).toBe(true);
  });
});
