/**
 * Integration test against the real dev database (DATABASE_URL from .env).
 * Organization isolation is fundamentally a query-layer guarantee, so it's
 * tested here rather than against the pure matcher/resolver functions.
 * Creates its own throwaway orgs/agents/policies and cleans them up in a
 * finally block regardless of outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as repo from "@/lib/policies/repository";
import { listActivePoliciesForEvaluation, listAgentPermissions } from "@/lib/policies/repository";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string };
let agentB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Org A", slug: `${RUN_ID}-org-a` } });
  orgB = await prisma.organization.create({ data: { name: "Org B", slug: `${RUN_ID}-org-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Agent A",
      slug: "agent-a",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentB = await prisma.agent.create({
    data: {
      organizationId: orgB.id,
      name: "Agent B",
      slug: "agent-b",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  await prisma.agentPermission.create({
    data: { organizationId: orgA.id, agentId: agentA.id, action: "invoice.read", resource: "", decision: "ALLOW" },
  });
  await prisma.policy.create({
    data: {
      organizationId: orgA.id,
      name: "Org A block policy",
      decision: "BLOCK",
      action: "customer.delete",
    },
  });
});

afterAll(async () => {
  // SecurityAlert.agent is onDelete: Restrict (Phase 6) — clear any
  // alerts the detectors created during evaluation before deleting agents.
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("organization isolation", () => {
  it("never returns another organization's policies", async () => {
    const policiesForOrgB = await listActivePoliciesForEvaluation(orgB.id, agentB.id);
    expect(policiesForOrgB).toHaveLength(0);

    const policiesForOrgA = await listActivePoliciesForEvaluation(orgA.id, agentA.id);
    expect(policiesForOrgA.map((p) => p.name)).toContain("Org A block policy");
  });

  it("never returns another organization's agent permissions", async () => {
    const permissionsForB = await listAgentPermissions(orgB.id, agentA.id);
    expect(permissionsForB).toHaveLength(0);
  });

  it("evaluateAgentAction refuses to evaluate an agent against the wrong organization", async () => {
    await expect(
      evaluateAgentAction({ organizationId: orgB.id, agentId: agentA.id, action: "invoice.read" })
    ).rejects.toThrow(/not found/i);
  });

  it("evaluateAgentAction resolves correctly within the right organization", async () => {
    const result = await evaluateAgentAction({
      organizationId: orgA.id,
      agentId: agentA.id,
      action: "invoice.read",
    });
    expect(result.decision).toBe("ALLOW");
  });
});

describe("policy management — mutation isolation and audit", () => {
  it("never lets one organization edit, disable, or delete another organization's policy", async () => {
    const policy = await repo.createPolicy(orgA.id, null, {
      name: "Org A isolation target",
      status: "ACTIVE",
      priority: 100,
      decision: "BLOCK",
      severity: "MEDIUM",
      action: "isolation.target",
      conditions: [],
    });

    const crossOrgUpdate = await repo.updatePolicy(orgB.id, policy.id, {
      name: "Hijacked",
      status: "ACTIVE",
      priority: 100,
      decision: "ALLOW",
      severity: "LOW",
      action: "isolation.target",
      conditions: [],
    });
    expect(crossOrgUpdate).toBeNull();

    const crossOrgStatusChange = await repo.setPolicyStatus(orgB.id, policy.id, "DISABLED");
    expect(crossOrgStatusChange).toBe(false);

    const crossOrgDelete = await repo.deletePolicy(orgB.id, policy.id);
    expect(crossOrgDelete).toBe(false);

    expect(await repo.getPolicy(orgB.id, policy.id)).toBeNull();

    // Untouched by any of the failed cross-org attempts.
    const stillThere = await repo.getPolicy(orgA.id, policy.id);
    expect(stillThere?.name).toBe("Org A isolation target");
    expect(stillThere?.status).toBe("ACTIVE");
    expect(stillThere?.decision).toBe("BLOCK");

    await repo.deletePolicy(orgA.id, policy.id);
  });

  it("records an audit event for policy create, update, disable, and delete", async () => {
    const policy = await repo.createPolicy(orgA.id, null, {
      name: "Audited policy",
      status: "ACTIVE",
      priority: 100,
      decision: "BLOCK",
      severity: "MEDIUM",
      action: "audit.target",
      conditions: [],
    });
    await recordAuditEvent(prisma, {
      organizationId: orgA.id,
      actorType: "USER",
      eventType: AUDIT_EVENT_TYPES.POLICY_CREATED,
      entityType: "Policy",
      entityId: policy.id,
      action: policy.action,
      metadata: { name: policy.name, decision: policy.decision, severity: policy.severity },
    });

    await repo.setPolicyStatus(orgA.id, policy.id, "DISABLED");
    await recordAuditEvent(prisma, {
      organizationId: orgA.id,
      actorType: "USER",
      eventType: AUDIT_EVENT_TYPES.POLICY_DISABLED,
      entityType: "Policy",
      entityId: policy.id,
      action: policy.action,
      metadata: { name: policy.name },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgA.id, entityType: "Policy", entityId: policy.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events.map((e) => e.eventType)).toEqual([
      AUDIT_EVENT_TYPES.POLICY_CREATED,
      AUDIT_EVENT_TYPES.POLICY_DISABLED,
    ]);
    expect(events[0]?.organizationId).toBe(orgA.id);
    expect((events[0]?.metadata as { decision?: string } | null)?.decision).toBe("BLOCK");

    // An audit trail scoped to org B never sees org A's policy changes.
    const crossOrgEvents = await prisma.auditEvent.findMany({
      where: { organizationId: orgB.id, entityType: "Policy", entityId: policy.id },
    });
    expect(crossOrgEvents).toHaveLength(0);

    await repo.deletePolicy(orgA.id, policy.id);
  });
});

describe("unsupported actions", () => {
  it("fails closed to BLOCK for an action with no permission and no policy configured", async () => {
    const result = await evaluateAgentAction({
      organizationId: orgA.id,
      agentId: agentA.id,
      action: "totally.unconfigured.action",
    });

    expect(result.decision).toBe("BLOCK");
    expect(result.reason).toMatch(/blocked by default/i);
    expect(result.matchedPolicySnapshots).toHaveLength(0);
    expect(result.matchedPermissionSnapshot).toBeUndefined();
  });
});

describe("ALERT decision", () => {
  it("allows the action, records the decision, and raises a security alert — never pretends the action was blocked", async () => {
    const alertPolicy = await prisma.policy.create({
      data: {
        organizationId: orgA.id,
        agentId: agentA.id,
        name: "Flag bulk exports",
        decision: "ALERT",
        severity: "HIGH",
        action: "data.export",
      },
    });

    const result = await evaluateAgentAction({
      organizationId: orgA.id,
      agentId: agentA.id,
      action: "data.export",
    });

    expect(result.decision).toBe("ALERT");
    expect(result.alertId).toBeDefined();

    // Recorded in the activity system as WARNING — succeeded, but flagged —
    // never ALLOWED (which would hide the violation) and never BLOCKED
    // (which would misreport an action that was never actually stopped).
    const evaluation = await repo.getPolicyEvaluation(orgA.id, result.evaluationId);
    expect(evaluation?.activityEvent?.status).toBe("WARNING");

    const alert = await prisma.securityAlert.findUnique({ where: { id: result.alertId! } });
    expect(alert?.organizationId).toBe(orgA.id);
    expect(alert?.agentId).toBe(agentA.id);
    expect(alert?.type).toBe("POLICY_ALERT");
    expect(alert?.severity).toBe("HIGH");

    await prisma.securityAlert.delete({ where: { id: result.alertId! } });
    await prisma.policy.delete({ where: { id: alertPolicy.id } });
  });
});
