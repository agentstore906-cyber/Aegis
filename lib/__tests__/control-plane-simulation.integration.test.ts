/**
 * Control plane — policy simulation, against the verified disposable test
 * database. Two properties matter and are tested directly:
 *
 *   1. NO SIDE EFFECTS: a simulation writes nothing (row counts of every
 *      evidence table are unchanged) and never creates or consumes an approval.
 *   2. PARITY: simulateAgentAction returns the same decision, decision source
 *      and reason as the real evaluateAgentAction for the same request, across
 *      a scenario matrix — so the simulator cannot drift from the engine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "@prisma/client";

import { prisma } from "@/lib/db";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { setAgentControlState } from "@/lib/agents/control";
import { resolveApproval } from "@/lib/approvals/service";
import { drainDeferredTasks } from "@/lib/server/defer";
import { simulateAgentAction, SimulationAgentNotFoundError } from "@/lib/control/simulate";
import type { PolicyEvaluationInput } from "@/lib/policies/types";
import { CALM, HIGH_REQ, configureRisk, makeAgent, nextSeq } from "@/lib/control/__tests__/fixtures";

const RUN_ID = `test_cp_sim_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let user: { id: string };

async function evidenceCounts(organizationId: string) {
  const where = { organizationId };
  const [evaluations, events, approvals, alerts, audit, deviations, baselines, trustStates, trustTransitions, incidents, labels] = await Promise.all([
    prisma.policyEvaluation.count({ where }),
    prisma.activityEvent.count({ where }),
    prisma.approvalRequest.count({ where }),
    prisma.securityAlert.count({ where }),
    prisma.auditEvent.count({ where }),
    prisma.behavioralDeviation.count({ where }),
    prisma.agentBaseline.count({ where }),
    prisma.agentTrustState.count({ where }),
    prisma.agentTrustTransition.count({ where }),
    prisma.incident.count({ where }),
    prisma.riskReviewLabel.count({ where }),
  ]);
  return { evaluations, events, approvals, alerts, audit, deviations, baselines, trustStates, trustTransitions, incidents, labels };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "CP Sim A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "CP Sim B", slug: `${RUN_ID}-b` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Simulation Operator" } });
}, 60_000);

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
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

type Scenario = {
  name: string;
  /** Prepare an agent (and org state) for the scenario. */
  setup: (agent: Agent) => Promise<void> | void;
  agent?: Parameters<typeof makeAgent>[1];
  request: Partial<PolicyEvaluationInput>;
  org?: () => { id: string };
  expect?: { decision: string; source: string };
  before?: () => Promise<void>;
};

const REQUEST = (over: Partial<PolicyEvaluationInput> = {}): Partial<PolicyEvaluationInput> => ({ action: "crm.export", tool: "CRM", contextSource: "agent", ...CALM, ...over });

const scenarios: Scenario[] = [
  { name: "permission ALLOW", setup: () => {}, request: REQUEST(), expect: { decision: "ALLOW", source: "POLICY" }, before: () => configureRisk(orgA.id, "OBSERVE") },
  { name: "default deny (nothing covers the action)", setup: () => {}, request: REQUEST({ action: "unlisted.action" }), expect: { decision: "BLOCK", source: "DEFAULT_DENY" } },
  { name: "permission REQUIRE_APPROVAL", setup: () => {}, request: REQUEST({ action: "refund.issue" }), expect: { decision: "REQUIRE_APPROVAL", source: "POLICY" } },
  {
    name: "policy BLOCK",
    setup: async (a) => void (await prisma.policy.create({ data: { organizationId: a.organizationId, agentId: a.id, name: "No exports", decision: "BLOCK", action: "crm.export" } })),
    request: REQUEST(),
    expect: { decision: "BLOCK", source: "POLICY" },
  },
  {
    name: "policy ALERT",
    setup: async (a) => void (await prisma.policy.create({ data: { organizationId: a.organizationId, agentId: a.id, name: "Watch exports", decision: "ALERT", severity: "LOW", action: "crm.export" } })),
    request: REQUEST(),
    expect: { decision: "ALERT", source: "POLICY" },
  },
  {
    name: "kill switch (STOPPED agent)",
    setup: async (a) => void (await setAgentControlState(a.organizationId, a.slug, "STOPPED", user.id, "drill")),
    request: REQUEST(),
    expect: { decision: "BLOCK", source: "CONTROL" },
  },
  {
    name: "destination allow-list: unlisted host (telemetry policy)",
    setup: async (a) =>
      void (await prisma.policy.create({
        data: { organizationId: a.organizationId, agentId: a.id, name: "Approved destinations only", decision: "BLOCK", action: "crm.export", conditions: { create: [{ field: "destination", operator: "NOT_IN", value: ["api.crm.example.com"] }] } },
      })),
    request: REQUEST({ telemetry: { service: "crm-api", destination: { destination: "evil.example", kind: "HOST" } } }),
    expect: { decision: "BLOCK", source: "POLICY" },
  },
  {
    name: "destination allow-list: listed host passes",
    setup: async (a) =>
      void (await prisma.policy.create({
        data: { organizationId: a.organizationId, agentId: a.id, name: "Approved destinations only", decision: "BLOCK", action: "crm.export", conditions: { create: [{ field: "destination", operator: "NOT_IN", value: ["api.crm.example.com"] }] } },
      })),
    request: REQUEST(),
    expect: { decision: "ALLOW", source: "POLICY" },
  },
  {
    name: "destination allow-list: OMITTED destination is blocked (fail closed)",
    setup: async (a) =>
      void (await prisma.policy.create({
        data: { organizationId: a.organizationId, agentId: a.id, name: "Approved destinations only", decision: "BLOCK", action: "crm.export", conditions: { create: [{ field: "destination", operator: "NOT_IN", value: ["api.crm.example.com"] }] } },
      })),
    request: REQUEST({ telemetry: undefined }),
    expect: { decision: "BLOCK", source: "POLICY" },
  },
  {
    name: "no credentials policy (data.CREDENTIALS)",
    setup: async (a) =>
      void (await prisma.policy.create({
        data: { organizationId: a.organizationId, agentId: a.id, name: "No credentials", decision: "BLOCK", action: "crm.export", conditions: { create: [{ field: "data.CREDENTIALS", operator: "EQUALS", value: true }] } },
      })),
    request: REQUEST({ telemetry: { service: "crm-api", destination: { destination: "api.crm.example.com", kind: "HOST" }, dataClasses: ["CREDENTIALS"] } }),
    expect: { decision: "BLOCK", source: "POLICY" },
  },
  {
    name: "risk OBSERVE: a HIGH-risk request is allowed but recommended against",
    agent: { baseline: true, trust: "TRUSTED" },
    before: () => configureRisk(orgA.id, "OBSERVE", "ALERT", "BLOCK"),
    setup: () => {},
    request: REQUEST(HIGH_REQ),
    expect: { decision: "ALLOW", source: "POLICY" },
  },
  {
    name: "risk ENFORCE (high=BLOCK): HIGH risk is blocked by risk control",
    agent: { baseline: true, trust: "TRUSTED" },
    before: () => configureRisk(orgA.id, "ENFORCE", "ALERT", "BLOCK"),
    setup: () => {},
    request: REQUEST(HIGH_REQ),
    expect: { decision: "BLOCK", source: "RISK" },
  },
  {
    name: "risk APPROVAL_REQUIRED (high=BLOCK): capped to REQUIRE_APPROVAL",
    agent: { baseline: true, trust: "TRUSTED" },
    before: () => configureRisk(orgA.id, "APPROVAL_REQUIRED", "ALERT", "BLOCK"),
    setup: () => {},
    request: REQUEST(HIGH_REQ),
    expect: { decision: "REQUIRE_APPROVAL", source: "RISK" },
  },
  {
    name: "risk ENFORCE: a kill-switched agent is still CONTROL, not RISK",
    agent: { baseline: true, trust: "TRUSTED" },
    before: () => configureRisk(orgA.id, "ENFORCE", "ALERT", "BLOCK"),
    setup: async (a) => void (await setAgentControlState(a.organizationId, a.slug, "PAUSED", user.id, "drill")),
    request: REQUEST(HIGH_REQ),
    expect: { decision: "BLOCK", source: "CONTROL" },
  },
];

describe("parity with the real engine, and zero side effects", () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      await (scenario.before ?? (() => configureRisk(orgA.id, "OBSERVE")))();
      const agent = await makeAgent(orgA.id, scenario.agent);
      await scenario.setup(agent);
      await drainDeferredTasks();
      const input = { organizationId: orgA.id, agentId: agent.id, ...scenario.request } as PolicyEvaluationInput;

      const before = await evidenceCounts(orgA.id);
      const simulated = await simulateAgentAction(input);
      await drainDeferredTasks();
      expect(await evidenceCounts(orgA.id), "a simulation must write nothing").toEqual(before);

      const real = await evaluateAgentAction(input);
      await drainDeferredTasks();

      expect(simulated.recorded).toBe(false);
      expect(simulated.decision).toBe(real.decision);
      expect(simulated.decisionSource).toBe(real.decisionSource);
      expect(simulated.reason).toBe(real.reason);
      expect(simulated.policyDecision).toBe(real.policyDecision);
      expect(simulated.matched.policies.map((p) => p.id)).toEqual(real.matchedPolicyIds);
      expect(simulated.matchingMode).toBe(real.matchingMode);
      if (scenario.expect) expect({ decision: simulated.decision, source: simulated.decisionSource }).toEqual(scenario.expect);
      // The real engine DID write (so the equality check above is meaningful).
      expect((await evidenceCounts(orgA.id)).evaluations).toBe(before.evaluations + 1);
      // When risk assessed it, simulation's assessment agrees with what the real run stored.
      if (simulated.risk) {
        const stored = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: real.evaluationId } });
        expect(stored.riskAssessedLevel).toBe(simulated.risk.level);
        expect(stored.riskRecommendedDecision).toBe(simulated.risk.shadow.recommended);
      }
      await configureRisk(orgA.id, "OBSERVE");
    });
  }

  it("the platform-wide risk-control switch is reflected identically (OBSERVE forced)", async () => {
    await configureRisk(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const input = { organizationId: orgA.id, agentId: agent.id, ...REQUEST(HIGH_REQ) } as PolicyEvaluationInput;
    process.env.AEGIS_RISK_CONTROL_DISABLED = "1";
    try {
      const simulated = await simulateAgentAction(input);
      const real = await evaluateAgentAction(input);
      expect(simulated.decision).toBe("ALLOW");
      expect(simulated.decision).toBe(real.decision);
      expect(simulated.riskControl).toMatchObject({ configuredMode: "ENFORCE", effectiveMode: "OBSERVE", globallyDisabled: true });
    } finally {
      delete process.env.AEGIS_RISK_CONTROL_DISABLED;
      await drainDeferredTasks();
      await configureRisk(orgA.id, "OBSERVE");
    }
  });
});

describe("what a simulation reports", () => {
  it("explains the decision stage by stage, in precedence order, and names what actually decided", async () => {
    await configureRisk(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const result = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST(HIGH_REQ) } as PolicyEvaluationInput);

    expect(result.stages.map((s) => s.stage)).toEqual(["KILL_SWITCH", "PERMISSION", "POLICY", "BEHAVIOR", "TRUST", "RISK", "RISK_CONTROL", "APPROVAL"]);
    const decisive = result.stages.filter((s) => s.decisive).map((s) => s.stage);
    expect(decisive).toEqual(expect.arrayContaining(["RISK_CONTROL"]));
    expect(result.stages.find((s) => s.stage === "BEHAVIOR")!.summary).toContain("deviation");
    expect(result.stages.find((s) => s.stage === "TRUST")!.summary).toContain("never decides on its own");
    expect(result.stages.find((s) => s.stage === "APPROVAL")!.summary).toBe("BLOCK is final: no approval can lift it.");
    expect(result.risk?.level).toBe("HIGH");
    expect(result.trust).toMatchObject({ state: "TRUSTED" });
    expect(result.behavior.baseline).toMatchObject({ maturity: "ESTABLISHED" });
    expect(result.behavior.deviations.length).toBeGreaterThan(0);
    expect(result.riskControl).toMatchObject({ effectiveMode: "ENFORCE", escalated: true, riskDecision: "BLOCK" });
    await configureRisk(orgA.id, "OBSERVE");
  });

  it("states identity, effective (server-side) context, and does not credit a caller's claimed environment", async () => {
    const agent = await makeAgent(orgA.id, { owner: "Revenue", environment: "PRODUCTION" });
    const result = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST({ environment: "DEVELOPMENT" }) } as PolicyEvaluationInput);
    expect(result.agent).toMatchObject({ slug: agent.slug, owner: "Revenue", environment: "PRODUCTION", status: "ACTIVE" });
    expect(result.effective).toMatchObject({ environment: "PRODUCTION", claimedEnvironmentIgnored: true });
    // The dashboard tester (an operator) may pick an environment on purpose.
    const operator = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST({ environment: "DEVELOPMENT", contextSource: "operator" }) } as PolicyEvaluationInput);
    expect(operator.effective.environment).toBe("DEVELOPMENT");
  });

  it("for REQUIRE_APPROVAL it describes the approval a real run would open, and opens none", async () => {
    const agent = await makeAgent(orgA.id);
    const before = await prisma.approvalRequest.count({ where: { agentId: agent.id } });
    const result = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST({ action: "refund.issue" }) } as PolicyEvaluationInput);
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.approval).toMatchObject({ required: true, wouldOpenRequest: true, reviewerRoles: ["OWNER", "ADMIN", "SECURITY"], note: "Simulation never creates or consumes an approval." });
    expect(result.approval.expiresInMs).toBeGreaterThan(0);
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(before);
  });

  it("never consumes an approved approval, even when the same request is simulated again and again", async () => {
    const agent = await makeAgent(orgA.id);
    const request = REQUEST({ action: "refund.issue" }) as Partial<PolicyEvaluationInput>;
    const first = await evaluateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...request } as PolicyEvaluationInput);
    await resolveApproval(orgA.id, first.approvalRequestId!, user.id, "APPROVED");
    for (let i = 0; i < 3; i += 1) await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...request } as PolicyEvaluationInput);
    const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: first.approvalRequestId! } });
    expect(approval.consumedAt).toBeNull();
    // ... so the real, single-use consumption still works afterwards.
    const used = await evaluateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...request, approvalRequestId: first.approvalRequestId } as PolicyEvaluationInput);
    expect(used).toMatchObject({ decision: "ALLOW", decisionSource: "APPROVAL" });
    await drainDeferredTasks();
  });

  it("reports honestly that a decision is returned, not guaranteed, and cites the agent's coverage evidence", async () => {
    const agent = await makeAgent(orgA.id);
    const quiet = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST() } as PolicyEvaluationInput);
    expect(quiet.enforcement).toMatchObject({ returns: "ALLOW", mechanism: "decision-api" });
    expect(quiet.enforcement.coverage.coverage).toBeNull();
    expect(quiet.enforcement.note).toContain("depends on the integration honoring it");
    expect(quiet.enforcement.note).toContain("no evidence either way");
  });

  it("does not echo secrets that were in the request context", async () => {
    const agent = await makeAgent(orgA.id);
    const result = await simulateAgentAction({ organizationId: orgA.id, agentId: agent.id, ...REQUEST({ context: { api_key: "sk-live-supersecretvalue123", amount: 5 } }) } as PolicyEvaluationInput);
    expect(JSON.stringify(result)).not.toContain("sk-live-supersecretvalue123");
  });
});

describe("tenant isolation", () => {
  it("another organization's agent is 'not found' and nothing is read or written", async () => {
    const bAgent = await makeAgent(orgB.id);
    const before = await evidenceCounts(orgB.id);
    await expect(simulateAgentAction({ organizationId: orgA.id, agentId: bAgent.id, ...REQUEST() } as PolicyEvaluationInput)).rejects.toBeInstanceOf(SimulationAgentNotFoundError);
    expect(await evidenceCounts(orgB.id)).toEqual(before);
  });

  it("another organization's policies, risk mode and permissions never influence the answer", async () => {
    await configureRisk(orgB.id, "ENFORCE", "REQUIRE_APPROVAL", "BLOCK");
    const bAgent = await makeAgent(orgB.id, { baseline: true, trust: "RESTRICTED" });
    await prisma.policy.create({ data: { organizationId: orgB.id, name: "B blocks all exports", decision: "BLOCK", action: "crm.export" } }); // org-wide policy in B
    const aAgent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    await configureRisk(orgA.id, "OBSERVE");
    const result = await simulateAgentAction({ organizationId: orgA.id, agentId: aAgent.id, ...REQUEST() } as PolicyEvaluationInput);
    expect(result.decision).toBe("ALLOW");
    expect(result.matched.policies).toEqual([]);
    expect(result.riskControl.configuredMode).toBe("OBSERVE");
    expect(result.trust?.state).toBe("TRUSTED");
    expect(bAgent.id).not.toBe(aAgent.id);
    await configureRisk(orgB.id, "OBSERVE");
  });
});

describe("determinism", () => {
  it("the same question asked twice gets the same answer", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const input = { organizationId: orgA.id, agentId: agent.id, ...REQUEST(HIGH_REQ) } as PolicyEvaluationInput;
    const a = await simulateAgentAction(input);
    const b = await simulateAgentAction(input);
    expect({ ...a, risk: a.risk && { ...a.risk, context: undefined } }).toEqual({ ...b, risk: b.risk && { ...b.risk, context: undefined } });
    expect(nextSeq()).toBeGreaterThan(0);
  });
});
