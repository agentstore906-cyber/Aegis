/**
 * Integration test against the real dev database, modeled on
 * lib/approvals/__tests__/approvals.integration.test.ts — dedup and
 * double-resolution race-safety are query-layer guarantees, tested here
 * rather than against pure functions.
 *
 * Dedup keys only on (agentId, type, status=OPEN, within the 24h window)
 * — deliberately not on title/description (see
 * lib/security/repository.ts#upsertAlertFinding). So each test that needs
 * an isolated dedup lineage gets its own throwaway agent, not just a
 * different title.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { acknowledgeAlert, getSecurityAlert, resolveAlert, upsertAlertFinding } from "@/lib/security/repository";
import { SecurityAlertAlreadyResolvedError, SecurityAlertNotFoundError } from "@/lib/security/types";
import { SECURITY_ALERT_TYPES, type Finding } from "@/lib/security/types";

const RUN_ID = `test_${Date.now()}`;
let agentSuffix = 0;

let orgA: { id: string };
let orgB: { id: string };
let user: { id: string };

/** A fresh agent per call — dedup keys on (agentId, type), so tests that need an isolated dedup lineage get their own agent, not just a different title. */
async function createTestAgent(organizationId = orgA.id): Promise<{ id: string }> {
  agentSuffix += 1;
  return prisma.agent.create({
    data: {
      organizationId,
      name: `Security Test Agent ${RUN_ID}-${agentSuffix}`,
      slug: `security-test-agent-${RUN_ID}-${agentSuffix}`,
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
}

function finding(agentId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    type: SECURITY_ALERT_TYPES.BLOCK_SPIKE,
    severity: "HIGH",
    agentId,
    title: "Test alert",
    description: "Test description",
    evidence: { count: 6 },
    ...overrides,
  };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Security Org A", slug: `${RUN_ID}-sec-a` } });
  orgB = await prisma.organization.create({ data: { name: "Security Org B", slug: `${RUN_ID}-sec-b` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}-security@example.com`, name: "Test Reviewer" } });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

describe("upsertAlertFinding — dedup", () => {
  it("creates a new alert on first trigger", async () => {
    const agent = await createTestAgent();
    const { created, alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    expect(created).toBe(true);
    expect(alert.count).toBe(1);
    expect(alert.status).toBe("OPEN");
  });

  it("increments count instead of creating a second row for a repeat trigger", async () => {
    const agent = await createTestAgent();
    const first = await upsertAlertFinding(orgA.id, finding(agent.id));
    const second = await upsertAlertFinding(orgA.id, finding(agent.id));

    expect(second.created).toBe(false);
    expect(second.alert.id).toBe(first.alert.id);
    expect(second.alert.count).toBe(2);

    const rowCount = await prisma.securityAlert.count({
      where: { organizationId: orgA.id, agentId: agent.id, type: SECURITY_ALERT_TYPES.BLOCK_SPIKE },
    });
    expect(rowCount).toBe(1);
  });

  it("creates a new alert if the previous one of the same type was already resolved", async () => {
    const agent = await createTestAgent();
    const first = await upsertAlertFinding(orgA.id, finding(agent.id));
    await resolveAlert(orgA.id, first.alert.id, user.id);

    const second = await upsertAlertFinding(orgA.id, finding(agent.id));
    expect(second.created).toBe(true);
    expect(second.alert.id).not.toBe(first.alert.id);
  });

  it("records an audit event only for the genuinely new alert, not dedup updates", async () => {
    const agent = await createTestAgent();
    const first = await upsertAlertFinding(orgA.id, finding(agent.id));
    await upsertAlertFinding(orgA.id, finding(agent.id));

    const auditCount = await prisma.auditEvent.count({
      where: {
        organizationId: orgA.id,
        entityType: "SecurityAlert",
        entityId: first.alert.id,
        eventType: "security_alert.created",
      },
    });
    expect(auditCount).toBe(1);
  });
});

describe("organization isolation", () => {
  it("never lets another organization read an alert", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    const fetchedFromB = await getSecurityAlert(orgB.id, alert.id);
    expect(fetchedFromB).toBeNull();
  });

  it("never lets another organization resolve an alert", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    await expect(resolveAlert(orgB.id, alert.id, user.id)).rejects.toThrow(SecurityAlertNotFoundError);

    const stillOpen = await prisma.securityAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stillOpen.status).toBe("OPEN");
  });
});

describe("acknowledge / resolve", () => {
  it("acknowledges an OPEN alert", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    const acknowledged = await acknowledgeAlert(orgA.id, alert.id, user.id);
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.acknowledgedByUserId).toBe(user.id);
  });

  it("resolves an ACKNOWLEDGED alert", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    await acknowledgeAlert(orgA.id, alert.id, user.id);
    const resolved = await resolveAlert(orgA.id, alert.id, user.id);
    expect(resolved.status).toBe("RESOLVED");
  });

  it("resolves an OPEN alert directly, without requiring acknowledgement first", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    const resolved = await resolveAlert(orgA.id, alert.id, user.id);
    expect(resolved.status).toBe("RESOLVED");
  });

  it("prevents acknowledging or resolving an already-resolved alert a second time", async () => {
    const agent = await createTestAgent();
    const { alert } = await upsertAlertFinding(orgA.id, finding(agent.id));
    await resolveAlert(orgA.id, alert.id, user.id);

    await expect(resolveAlert(orgA.id, alert.id, user.id)).rejects.toThrow(SecurityAlertAlreadyResolvedError);
    await expect(acknowledgeAlert(orgA.id, alert.id, user.id)).rejects.toThrow(SecurityAlertAlreadyResolvedError);
  });

  it("throws for a nonexistent alert id", async () => {
    await expect(resolveAlert(orgA.id, "nonexistent-id", user.id)).rejects.toThrow(SecurityAlertNotFoundError);
  });
});
