/**
 * The Free three-agent limit and how agents are counted against it. Retired (ARCHIVED) agents count, everywhere:
 * the pre-check, the race-safe guard and the usage numbers shown to the user all use lib/agents/quota.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { PLANS } from "@/lib/billing/plans";
import { checkAgentLimitLocked } from "@/lib/agents/creation-guard";
import { countAgentsTowardLimit, countRetiredAgents } from "@/lib/agents/quota";

const RUN = `quota_${Date.now()}`;
let free: { id: string };
let startup: { id: string };

const addAgent = (organizationId: string, name: string, status: "ACTIVE" | "ARCHIVED" = "ACTIVE") =>
  prisma.agent.create({ data: { organizationId, name, slug: `${RUN}-${name}`, owner: "t", modelProvider: "x", modelName: "y", status } });
const guard = (organizationId: string) => prisma.$transaction((tx) => checkAgentLimitLocked(tx, organizationId));

beforeAll(async () => {
  free = await prisma.organization.create({ data: { name: "Quota Free", slug: `${RUN}-free`, plan: "free" } });
  startup = await prisma.organization.create({ data: { name: "Quota Startup", slug: `${RUN}-startup`, plan: "startup" } });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { organizationId: { in: [free.id, startup.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [free.id, startup.id] } } });
  await prisma.$disconnect();
});

describe("Free plan agent limit", () => {
  it("is three, and the first three agents are allowed without payment", async () => {
    expect(PLANS.free.agentLimit).toBe(3);
    expect(PLANS.free.priceCents).toBe(0);
    for (const name of ["a1", "a2", "a3"]) {
      expect((await guard(free.id)).allowed).toBe(true);
      await addAgent(free.id, name);
    }
  });

  it("the fourth is refused by the locked backend check, with an upgrade target", async () => {
    const fourth = await guard(free.id);
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) {
      expect(fourth.reason).toContain("limited to 3 agents");
      expect(fourth.upgradeTo).toBe("startup");
    }
  });

  it("a retired agent still counts: archiving does not release a slot", async () => {
    await prisma.agent.updateMany({ where: { organizationId: free.id, slug: `${RUN}-a1` }, data: { status: "ARCHIVED" } });
    expect(await countAgentsTowardLimit(prisma, free.id)).toBe(3);
    expect(await countRetiredAgents(prisma, free.id)).toBe(1);
    expect((await guard(free.id)).allowed).toBe(false);
  });

  it("the guard and the usage count agree for every status mix (one definition)", async () => {
    const org = await prisma.organization.create({ data: { name: "Quota Mix", slug: `${RUN}-mix`, plan: "free" } });
    try {
      await addAgent(org.id, "m1", "ARCHIVED");
      await addAgent(org.id, "m2", "ARCHIVED");
      expect(await countAgentsTowardLimit(prisma, org.id)).toBe(2);
      expect((await guard(org.id)).allowed).toBe(true); // 2 < 3
      await addAgent(org.id, "m3");
      expect(await countAgentsTowardLimit(prisma, org.id)).toBe(3);
      expect((await guard(org.id)).allowed).toBe(false);
    } finally {
      await prisma.agent.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("counts are per organization", async () => {
    expect(await countAgentsTowardLimit(prisma, startup.id)).toBe(0);
    expect((await guard(startup.id)).allowed).toBe(true);
  });
});
