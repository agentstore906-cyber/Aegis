import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@prisma/client";

import { adoptionStage, attentionFlags, derivePosture, isUnowned, type AttentionInput } from "@/lib/control/posture";
import { assuranceFor } from "@/lib/control/identity";

describe("derivePosture", () => {
  const base = { permissionCount: 3, activityEvents: 10, decisionRequests: 5 };

  it("operator-controlled states win over everything the data says", () => {
    const expected: Record<Exclude<AgentStatus, "ACTIVE">, string> = { ARCHIVED: "RETIRED", STOPPED: "STOPPED", PAUSED: "PAUSED", NEEDS_ATTENTION: "NEEDS_ATTENTION" };
    for (const [status, posture] of Object.entries(expected)) {
      expect(derivePosture({ ...base, status: status as AgentStatus })).toBe(posture);
      expect(derivePosture({ status: status as AgentStatus, permissionCount: 0, activityEvents: 0, decisionRequests: 0 })).toBe(posture);
    }
  });

  it("an ACTIVE agent is classified by what the data shows", () => {
    expect(derivePosture({ status: "ACTIVE", permissionCount: 0, activityEvents: 50, decisionRequests: 9 })).toBe("DISCOVERED"); // nothing granted: default-deny
    expect(derivePosture({ status: "ACTIVE", ...base })).toBe("PROTECTED");
    expect(derivePosture({ status: "ACTIVE", permissionCount: 2, activityEvents: 10, decisionRequests: 0 })).toBe("OBSERVED");
    expect(derivePosture({ status: "ACTIVE", permissionCount: 2, activityEvents: 0, decisionRequests: 0 })).toBe("QUIET");
  });
});

describe("adoptionStage — CONNECT → OBSERVE → PROTECT from data", () => {
  it.each([
    [0, 0, "CONNECTED"],
    [12, 0, "OBSERVING"],
    [0, 3, "PROTECTED"],
    [12, 3, "PROTECTED"],
  ] as const)("activity %i, decisions %i → %s", (activityEvents, decisionRequests, stage) => {
    expect(adoptionStage({ activityEvents, decisionRequests })).toBe(stage);
  });
});

describe("attentionFlags", () => {
  const calm: AttentionInput = {
    trustState: "TRUSTED",
    deviations7d: 0,
    openIncidents: 0,
    pendingApprovals: 0,
    broadGrants: 0,
    identityAssurance: "ISOLATED",
    activityEvents: 10,
    ranDespite: 0,
    owner: "Platform",
  };

  it("a calm, owned, isolated agent has no flags", () => expect(attentionFlags(calm)).toEqual([]));

  it("each condition raises exactly its own flag", () => {
    expect(attentionFlags({ ...calm, trustState: "DEGRADED" })).toEqual(["TRUST_DEGRADED"]);
    expect(attentionFlags({ ...calm, trustState: "HIGH_RISK" })).toEqual(["TRUST_DEGRADED"]);
    expect(attentionFlags({ ...calm, trustState: "RESTRICTED" })).toEqual(["TRUST_DEGRADED"]);
    expect(attentionFlags({ ...calm, deviations7d: 2 })).toEqual(["UNUSUAL_BEHAVIOR"]);
    expect(attentionFlags({ ...calm, openIncidents: 1 })).toEqual(["OPEN_INCIDENT"]);
    expect(attentionFlags({ ...calm, pendingApprovals: 1 })).toEqual(["PENDING_APPROVAL"]);
    expect(attentionFlags({ ...calm, broadGrants: 1 })).toEqual(["BROAD_GRANT"]);
    expect(attentionFlags({ ...calm, ranDespite: 1 })).toEqual(["RAN_DESPITE_DECISION"]);
    expect(attentionFlags({ ...calm, owner: "API" })).toEqual(["NO_OWNER"]);
  });

  it("no trust evaluation is not 'degraded' — absence is not a finding", () => {
    expect(attentionFlags({ ...calm, trustState: null })).toEqual([]);
  });

  it("shared-key identity is flagged only for agents that actually use the API, and only when no dedicated key exists", () => {
    expect(attentionFlags({ ...calm, identityAssurance: "ORG_WIDE_ONLY" })).toEqual(["SHARED_IDENTITY"]);
    expect(attentionFlags({ ...calm, identityAssurance: "ORG_WIDE_ONLY", activityEvents: 0 })).toEqual([]);
    expect(attentionFlags({ ...calm, identityAssurance: "BOUND_SHARED" })).toEqual([]);
    expect(attentionFlags({ ...calm, identityAssurance: "NO_KEY" })).toEqual([]);
  });

  it("unowned means nobody was assigned — blank, the self-registration default 'API', or placeholders", () => {
    for (const owner of ["", "  ", "API", "api", "Unknown", "unassigned", "None", "n/a"]) expect(isUnowned(owner), owner).toBe(true);
    for (const owner of ["Platform", "Revenue", "Ada Lovelace", "api-team"]) expect(isUnowned(owner), owner).toBe(false);
  });
});

describe("identity assurance", () => {
  it("is ISOLATED only when the agent has its own key AND no shared key could speak for it", () => {
    expect(assuranceFor(1, 0)).toBe("ISOLATED");
    expect(assuranceFor(2, 0)).toBe("ISOLATED");
    expect(assuranceFor(1, 1)).toBe("BOUND_SHARED");
    expect(assuranceFor(0, 3)).toBe("ORG_WIDE_ONLY");
    expect(assuranceFor(0, 0)).toBe("NO_KEY");
  });
});
