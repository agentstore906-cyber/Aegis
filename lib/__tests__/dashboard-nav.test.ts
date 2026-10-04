import { describe, expect, it } from "vitest";

import { NAV_ITEMS, activeHref, navFor } from "@/lib/dashboard-nav";
import { paletteCommands } from "@/lib/dashboard-commands";

const hrefs = (role: Parameters<typeof navFor>[0]) => {
  const { groups, utility } = navFor(role);
  return [...groups.flatMap((g) => g.items), ...utility].map((i) => i.href);
};

describe("navigation by role", () => {
  it("never lists a destination twice", () => {
    const all = NAV_ITEMS.map((i) => i.href);
    expect(new Set(all).size).toBe(all.length);
  });

  it("hides security, incidents, control plane and risk control from FINANCE; billing stays", () => {
    const h = hrefs("FINANCE");
    for (const hidden of ["/control", "/incidents", "/security", "/risk-control"]) expect(h).not.toContain(hidden);
    expect(h).toContain("/settings/billing");
  });

  it("hides billing from ENGINEER and shows it to OWNER", () => {
    expect(hrefs("ENGINEER")).not.toContain("/settings/billing");
    expect(hrefs("OWNER")).toContain("/settings/billing");
  });

  it("drops a whole group when nothing in it is visible", () => {
    for (const role of ["OWNER", "FINANCE", "VIEWER", "ENGINEER", "SECURITY", "ADMIN"] as const) {
      for (const g of navFor(role).groups) expect(g.items.length).toBeGreaterThan(0);
    }
  });
});

describe("active item", () => {
  const items = NAV_ITEMS;
  it("matches sub-pages to their section", () => {
    expect(activeHref("/agents/abc", items)).toBe("/agents");
    expect(activeHref("/incidents/xyz", items)).toBe("/incidents");
  });
  it("does not match on a shared string prefix", () => {
    expect(activeHref("/agents-old", items)).toBeNull();
  });
  it("lights up only one item for billing and other settings pages", () => {
    expect(activeHref("/settings/billing", items)).toBe("/settings/billing");
    expect(activeHref("/settings/members", items)).toBe("/settings/organization");
  });
});

describe("command palette commands", () => {
  it("offers only destinations the role may open", () => {
    const f = paletteCommands("FINANCE").map((c) => c.href);
    expect(f).not.toContain("/incidents");
    expect(f).not.toContain("/policies/new");
    expect(f).not.toContain("/developers/api-keys");
    const o = paletteCommands("OWNER").map((c) => c.href);
    expect(o).toContain("/policies/new");
    expect(o).toContain("/developers/api-keys");
  });
  it("has unique ids", () => {
    const ids = paletteCommands("OWNER").map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
