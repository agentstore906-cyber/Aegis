/**
 * Advanced-policy entitlement, enforced on the backend for every operation that creates, updates or enables a
 * policy with conditions. Drives the real server actions (session mocked) and the repository against the test DB.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import * as repo from "@/lib/policies/repository";
import { AdvancedPolicyNotAllowedError } from "@/lib/policies/entitlement";

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/organizations/queries", () => ({ requireActiveOrganization: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { createPolicyAction, setPolicyStatusAction, updatePolicyAction } from "@/lib/policies/actions";

const RUN_ID = `polent_${Date.now()}`;
const CONDITIONS = JSON.stringify([{ field: "context.amount", operator: "GREATER_THAN", value: "500" }]);

let freeOrg: { id: string; plan: string };
let startupOrg: { id: string; plan: string };
let user: { id: string };

const as = (org: { id: string; plan: string }, role = "OWNER") => {
  session.current = { organization: org, user, role };
};

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Large refunds",
    status: "ACTIVE",
    priority: "100",
    decision: "REQUIRE_APPROVAL",
    severity: "MEDIUM",
    action: "refund.issue",
    conditionsJson: "[]",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

const policyCount = (organizationId: string) => prisma.policy.count({ where: { organizationId } });
const conditionCount = (policyId: string) => prisma.policyCondition.count({ where: { policyId } });

async function seedPolicy(organizationId: string, opts: { conditions: boolean; status: "ACTIVE" | "DISABLED" }) {
  return prisma.policy.create({
    data: {
      organizationId,
      name: `seed-${Math.random().toString(36).slice(2, 8)}`,
      decision: "REQUIRE_APPROVAL",
      action: "refund.issue",
      status: opts.status,
      ...(opts.conditions ? { conditions: { create: [{ field: "context.amount", operator: "GREATER_THAN", value: 500 }] } } : {}),
    },
  });
}

beforeAll(async () => {
  freeOrg = await prisma.organization.create({ data: { name: "Pol Free", slug: `${RUN_ID}-free`, plan: "free" } });
  startupOrg = await prisma.organization.create({ data: { name: "Pol Startup", slug: `${RUN_ID}-startup`, plan: "startup" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Policy Owner" } });
});

beforeEach(async () => {
  await prisma.policy.deleteMany({ where: { organizationId: { in: [freeOrg.id, startupOrg.id] } } });
});

afterAll(async () => {
  const ids = [freeOrg.id, startupOrg.id];
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: ids } } }).catch(() => undefined);
  await prisma.policy.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
});

describe("Free organizations are denied advanced policies by the backend", () => {
  it("createPolicyAction refuses conditions, with an upgrade message, and writes nothing", async () => {
    as(freeOrg);
    const result = await createPolicyAction({}, form({ conditionsJson: CONDITIONS }));
    expect(result.error).toMatch(/Free plan/);
    expect(result.error).toMatch(/Upgrade to the Startup plan/);
    expect(await policyCount(freeOrg.id)).toBe(0);
  });

  it("createPolicyAction still creates a basic policy on Free (no conditions)", async () => {
    as(freeOrg);
    await expect(createPolicyAction({}, form())).rejects.toThrow(/^NEXT_REDIRECT:\/policies\/.+\/edit$/);
    expect(await policyCount(freeOrg.id)).toBe(1);
  });

  it("updatePolicyAction refuses adding conditions to an existing basic policy and leaves it unchanged", async () => {
    as(freeOrg);
    const basic = await seedPolicy(freeOrg.id, { conditions: false, status: "ACTIVE" });
    const result = await updatePolicyAction(basic.id, {}, form({ name: "renamed", conditionsJson: CONDITIONS }));
    expect(result.error).toMatch(/Free plan/);
    expect(await conditionCount(basic.id)).toBe(0);
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: basic.id } })).name).not.toBe("renamed");
  });

  it("updatePolicyAction lets a Free org REMOVE conditions it inherited from a higher plan", async () => {
    as(freeOrg);
    const legacy = await seedPolicy(freeOrg.id, { conditions: true, status: "ACTIVE" });
    await expect(updatePolicyAction(legacy.id, {}, form({ conditionsJson: "[]" }))).rejects.toThrow(/^NEXT_REDIRECT:\/policies$/);
    expect(await conditionCount(legacy.id)).toBe(0);
  });

  it("updatePolicyAction refuses to save a policy that still has conditions", async () => {
    as(freeOrg);
    const legacy = await seedPolicy(freeOrg.id, { conditions: true, status: "ACTIVE" });
    const result = await updatePolicyAction(legacy.id, {}, form({ name: "still conditional", conditionsJson: CONDITIONS }));
    expect(result.error).toMatch(/Free plan/);
    expect(await conditionCount(legacy.id)).toBe(1);
  });

  it("setPolicyStatusAction refuses to ENABLE a conditional policy, but disabling is always allowed", async () => {
    as(freeOrg);
    const disabled = await seedPolicy(freeOrg.id, { conditions: true, status: "DISABLED" });
    const enable = await setPolicyStatusAction(disabled.id, "ACTIVE");
    expect(enable.error).toMatch(/Free plan/);
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: disabled.id } })).status).toBe("DISABLED");

    const active = await seedPolicy(freeOrg.id, { conditions: true, status: "ACTIVE" });
    expect(await setPolicyStatusAction(active.id, "DISABLED")).toEqual({});
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("DISABLED");
  });

  it("setPolicyStatusAction can enable a BASIC policy on Free", async () => {
    as(freeOrg);
    const basic = await seedPolicy(freeOrg.id, { conditions: false, status: "DISABLED" });
    expect(await setPolicyStatusAction(basic.id, "ACTIVE")).toEqual({});
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: basic.id } })).status).toBe("ACTIVE");
  });

  it("the repository itself refuses, so no future caller can bypass the actions", async () => {
    const input = { name: "x", status: "ACTIVE" as const, priority: 1, decision: "BLOCK" as const, severity: "LOW" as const, action: "a.b", conditions: [{ field: "context.n", operator: "EQUALS" as const, value: 1 }] };
    await expect(repo.createPolicy(freeOrg.id, null, input)).rejects.toBeInstanceOf(AdvancedPolicyNotAllowedError);
    const basic = await seedPolicy(freeOrg.id, { conditions: false, status: "ACTIVE" });
    await expect(repo.updatePolicy(freeOrg.id, basic.id, input)).rejects.toBeInstanceOf(AdvancedPolicyNotAllowedError);
    // The failed update ran in its own transaction: nothing was deleted or added.
    expect(await conditionCount(basic.id)).toBe(0);
  });
});

describe("paid plans keep advanced policies", () => {
  it("Startup can create, update and enable policies with conditions", async () => {
    as(startupOrg);
    await expect(createPolicyAction({}, form({ conditionsJson: CONDITIONS }))).rejects.toThrow(/^NEXT_REDIRECT:/);
    const created = await prisma.policy.findFirstOrThrow({ where: { organizationId: startupOrg.id } });
    expect(await conditionCount(created.id)).toBe(1);

    await expect(updatePolicyAction(created.id, {}, form({ name: "edited", conditionsJson: CONDITIONS }))).rejects.toThrow(/^NEXT_REDIRECT:\/policies$/);
    expect(await setPolicyStatusAction(created.id, "DISABLED")).toEqual({});
    expect(await setPolicyStatusAction(created.id, "ACTIVE")).toEqual({});
  });
});

describe("organization isolation", () => {
  it("a Free org's session cannot change a Startup org's policy, and entitlement follows the ACTING org's plan", async () => {
    const theirs = await seedPolicy(startupOrg.id, { conditions: true, status: "ACTIVE" });
    as(freeOrg);
    // Not found in the acting org: updatePolicy returns null before any entitlement decision.
    const result = await updatePolicyAction(theirs.id, {}, form({ conditionsJson: "[]" })).catch((e: Error) => ({ error: e.message }));
    expect(result).toEqual({ error: "Policy not found" });
    expect(await conditionCount(theirs.id)).toBe(1);
  });
});
