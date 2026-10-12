import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemberRole } from "@prisma/client";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import { canAccessUpgradePage, canViewBilling } from "@/lib/billing/authorization";
import { hasCapability } from "@/lib/rbac/capabilities";

const ROLES: MemberRole[] = ["OWNER", "ADMIN", "ENGINEER", "SECURITY", "FINANCE", "VIEWER"];

describe("Upgrade link vs the /upgrade page", () => {
  it("the page's rule and the link's rule are the same function", () => {
    for (const role of ROLES) expect(canAccessUpgradePage(role)).toBe(canViewBilling(role));
  });

  it("roles that can connect agents but not view billing (ENGINEER, SECURITY) never get a link to a 404", () => {
    const connectButNoBilling = ROLES.filter((r) => hasCapability(r, "manage_agents") && !canAccessUpgradePage(r));
    expect(connectButNoBilling.sort()).toEqual(["ENGINEER", "SECURITY"]);
    for (const role of connectButNoBilling) {
      const html = renderToStaticMarkup(<UpgradeLink canUpgrade={canAccessUpgradePage(role)} />);
      expect(html).not.toContain("/upgrade");
      expect(html).toContain("Ask a workspace owner or admin to upgrade");
    }
  });

  it("OWNER, ADMIN and FINANCE (who can open the page) get the link", () => {
    for (const role of ["OWNER", "ADMIN", "FINANCE"] as const) {
      expect(renderToStaticMarkup(<UpgradeLink canUpgrade={canAccessUpgradePage(role)} />)).toContain('href="/upgrade"');
    }
  });

  it("opening the page grants no billing power: only OWNER/ADMIN can manage billing", () => {
    expect(hasCapability("FINANCE", "manage_billing")).toBe(false);
    expect(canAccessUpgradePage("VIEWER")).toBe(false);
  });
});
