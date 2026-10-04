/**
 * Control plane — the policy tester server action, with a mocked session so each
 * ROLE goes through the real gating code. Security finding S1: the tester used
 * to run the real engine for any organization member, writing evaluations,
 * approval requests and alerts that feed an agent's trust and risk history
 * (trust poisoning by a VIEWER). Now: simulation (read-only) is the default and
 * needs the security view; recording needs `manage_policies`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@prisma/client";

let session: { organization: { id: string; name: string }; user: { id: string }; role: MemberRole };

vi.mock("@/lib/organizations/queries", () => ({ requireActiveOrganization: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { prisma } from "@/lib/db";
import { runPolicyTesterAction } from "@/lib/policies/actions";
import { drainDeferredTasks } from "@/lib/server/defer";
import { makeAgent } from "@/lib/control/__tests__/fixtures";

const RUN_ID = `test_cp_tester_${Date.now()}`;
let orgA: { id: string; name: string };
let orgB: { id: string; name: string };
let user: { id: string };
let agentId: string;
let foreignAgentId: string;

function form(fields: Record<string, string | string[] | undefined>) {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) f.append(key, v);
  }
  return f;
}
const as = (role: MemberRole) => {
  session = { organization: orgA, user, role };
};
const baseFields = () => ({ agentId, action: "crm.export", resource: "", environment: "", tool: "", riskLevel: "", contextJson: "" });
const run = (fields: Record<string, string | string[] | undefined>) => runPolicyTesterAction({}, form({ ...baseFields(), ...fields }));

async function counts() {
  const where = { organizationId: orgA.id };
  const [evaluations, events, approvals, audit, alerts] = await Promise.all([
    prisma.policyEvaluation.count({ where }),
    prisma.activityEvent.count({ where }),
    prisma.approvalRequest.count({ where }),
    prisma.auditEvent.count({ where }),
    prisma.securityAlert.count({ where }),
  ]);
  return { evaluations, events, approvals, audit, alerts };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Tester A", slug: `${RUN_ID}-a`, plan: "enterprise" } });
  orgB = await prisma.organization.create({ data: { name: "Tester B", slug: `${RUN_ID}-b`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Tester" } });
  agentId = (await makeAgent(orgA.id, { permissions: [{ action: "crm.export", decision: "ALLOW" }, { action: "refund.issue", decision: "REQUIRE_APPROVAL" }] })).id;
  foreignAgentId = (await makeAgent(orgB.id)).id;
  await prisma.policy.create({
    data: {
      organizationId: orgA.id,
      agentId,
      name: "Approved destinations only",
      decision: "BLOCK",
      action: "crm.export",
      conditions: { create: [{ field: "destination", operator: "NOT_IN", value: ["api.crm.example.com"] }] },
    },
  });
}, 60_000);

beforeEach(() => as("SECURITY"));

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  await prisma.incidentActivity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.incident.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

describe("simulation is the default and records nothing", () => {
  it("with no mode given, a VIEWER gets a read-only simulation and no row is written anywhere", async () => {
    as("VIEWER");
    const before = await counts();
    const state = await run({ destination: "api.crm.example.com" });
    await drainDeferredTasks();
    expect(state.error).toBeUndefined();
    expect(state.result).toBeUndefined();
    expect(state.simulation).toMatchObject({ recorded: false, decision: "ALLOW" });
    expect(await counts()).toEqual(before);
  });

  it("a simulation of a REQUIRE_APPROVAL action opens no approval request and raises no alert", async () => {
    as("VIEWER");
    const before = await counts();
    const state = await run({ action: "refund.issue", mode: "simulate" });
    expect(state.simulation).toMatchObject({ decision: "REQUIRE_APPROVAL", approval: { required: true, wouldOpenRequest: true } });
    expect(await counts()).toEqual(before);
  });

  it("FINANCE (no security view) cannot simulate: it would reveal risk, trust and behavior", async () => {
    as("FINANCE");
    const before = await counts();
    const state = await run({ mode: "simulate" });
    expect(state.error).toContain("your role cannot see");
    expect(state.simulation).toBeUndefined();
    expect(await counts()).toEqual(before);
  });
});

describe("recording needs permission to manage policies", () => {
  it.each(["VIEWER", "ENGINEER", "FINANCE"] as MemberRole[])("%s cannot record a real evaluation, and nothing is written", async (role) => {
    as(role);
    const before = await counts();
    const state = await run({ mode: "record" });
    expect(state.error).toContain("manage policies");
    expect(state.result).toBeUndefined();
    expect(state.simulation).toBeUndefined();
    await drainDeferredTasks();
    expect(await counts()).toEqual(before);
  });

  it.each(["SECURITY", "ADMIN", "OWNER"] as MemberRole[])("%s can record, and the real engine writes exactly one evaluation", async (role) => {
    as(role);
    const before = await counts();
    const state = await run({ mode: "record", destination: "api.crm.example.com" });
    await drainDeferredTasks();
    expect(state.error).toBeUndefined();
    expect(state.result).toMatchObject({ decision: "ALLOW" });
    expect((await counts()).evaluations).toBe(before.evaluations + 1);
  });

  it("an unknown mode falls back to nothing dangerous: it is rejected, not treated as record", async () => {
    as("SECURITY");
    const before = await counts();
    const state = await run({ mode: "execute" });
    expect(state.error).toBeTruthy();
    expect(state.result).toBeUndefined();
    expect(await counts()).toEqual(before);
  });
});

describe("telemetry inputs reach the policy engine, with the same normalization as the API", () => {
  it("a destination allow-list: allowed host passes, other host is blocked, omitted destination is blocked (fail closed)", async () => {
    const allowed = await run({ destination: "https://API.CRM.example.com/path?token=1" });
    expect(allowed.simulation).toMatchObject({ decision: "ALLOW" });
    const other = await run({ destination: "evil.example" });
    expect(other.simulation).toMatchObject({ decision: "BLOCK", decisionSource: "POLICY" });
    expect(other.simulation?.matched.policies.map((p) => p.name)).toEqual(["Approved destinations only"]);
    const omitted = await run({});
    expect(omitted.simulation).toMatchObject({ decision: "BLOCK", decisionSource: "POLICY" });
  });

  it("rejects malformed telemetry instead of ignoring it", async () => {
    expect((await run({ recordCount: "-5" })).error).toBeTruthy();
    expect((await run({ dataClasses: ["NOT_A_CLASS"] })).error).toBeTruthy();
    expect((await run({ destination: "not a host !!" })).error).toBeTruthy();
  });

  it("data classes are accepted and normalized", async () => {
    const state = await run({ destination: "api.crm.example.com", dataClasses: ["PII", "FINANCIAL"], recordCount: "12" });
    expect(state.error).toBeUndefined();
    expect(state.simulation?.decision).toBe("ALLOW");
  });
});

describe("tenant isolation", () => {
  it("another organization's agent id is 'not found' in both modes, and nothing is written", async () => {
    const before = await counts();
    const sim = await run({ agentId: foreignAgentId });
    const rec = await run({ agentId: foreignAgentId, mode: "record" });
    expect(sim.error).toBe("Agent not found in this organization.");
    expect(rec.error).toBe("Agent not found in this organization.");
    expect(await counts()).toEqual(before);
    expect(await prisma.policyEvaluation.count({ where: { agentId: foreignAgentId } })).toBe(0);
  });

  it("the organization always comes from the session, never from the form", async () => {
    const before = await counts();
    const state = await runPolicyTesterAction({}, form({ ...baseFields(), organizationId: orgB.id, destination: "api.crm.example.com" }));
    expect(state.simulation?.agent.id).toBe(agentId);
    expect(await counts()).toEqual(before);
  });
});
