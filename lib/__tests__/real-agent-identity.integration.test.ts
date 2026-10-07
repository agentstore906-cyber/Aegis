/**
 * The agent-initiated (SDK) path: a credential bound to ONE agent is the only thing that can establish that agent's
 * identity, and nothing the caller types can substitute another. (Connecting TO an external agent, and scanning it, is
 * covered by endpoint-agent-connection.integration.test.ts.) In-process against the verified disposable test database;
 * the handshake is the real route handler called with the credential Aegis issued.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { connectProviderAgent, disconnectAgentConnection } from "@/lib/agents/connection-service";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { createApiKey } from "@/lib/api-keys/repository";
import { POST as handshakeHandler } from "@/app/api/v1/connect/handshake/route";
import { linkScanToAgent, newScanId } from "@/lib/scanner/service";

const RUN = `ident_${Date.now()}`;
const ctx = { params: Promise.resolve<Record<string, string>>({}) };

let userId: string;
let orgA: string;
let orgB: string;
let orgFree: string;

type Agent = { id: string; slug: string; key: string };
async function connect(organizationId: string, name: string): Promise<Agent> {
  const r = await connectProviderAgent({ organizationId, userId, ownerLabel: "t", connectorType: "CUSTOM_SDK", agentName: name });
  if (!r.ok || !("apiKeyRaw" in r) || !r.apiKeyRaw) throw new Error(`connect failed: ${JSON.stringify(r)}`);
  return { id: r.agentId, slug: r.agentSlug, key: r.apiKeyRaw };
}
const post = (key: string | null, body: unknown = {}) =>
  handshakeHandler(
    new Request("http://localhost/api/v1/connect/handshake", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    }),
    ctx
  );
const hello = (a: Agent, body: unknown = {}) => post(a.key, body);
const state = async (orgId: string, slug: string) => (await getAgentConnectionSnapshot(orgId, slug))!.view.state;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `${RUN}@example.com`, name: "T" } })).id;
  orgA = (await prisma.organization.create({ data: { name: "Ident A", slug: `${RUN}-a`, plan: "enterprise" } })).id;
  orgB = (await prisma.organization.create({ data: { name: "Ident B", slug: `${RUN}-b`, plan: "enterprise" } })).id;
  orgFree = (await prisma.organization.create({ data: { name: "Ident Free", slug: `${RUN}-f`, plan: "free" } })).id;
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a pending SDK record is not a connected agent", () => {
  it("is WAITING until a request authenticated with its own credential arrives; strangers connect nothing", async () => {
    const a = await connect(orgA, `Pending ${RUN}`);
    expect(await state(orgA, a.slug)).toBe("WAITING");
    for (const key of [null, "nope", `aegis_live_${"x".repeat(32)}`]) expect((await post(key)).status).toBe(401);
    expect(await state(orgA, a.slug)).toBe("WAITING");
    expect((await hello(a)).status).toBe(200);
    expect(await state(orgA, a.slug)).toBe("CONNECTED");
  });
});

describe("duplicate connection attempts", () => {
  it("retrying Connect for a not-yet-contacted SDK agent reuses the record and revokes the unused credential", async () => {
    const first = await connect(orgA, `Dup ${RUN}`);
    const second = await connect(orgA, `dup ${RUN}`);
    const third = await connect(orgA, `Dup ${RUN}`);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(await prisma.agent.count({ where: { organizationId: orgA, slug: first.slug } })).toBe(1);
    expect((await hello(first)).status).toBe(401);
    expect((await hello(second)).status).toBe(401);
    expect((await hello(third)).status).toBe(200);
  });

  it("a repeated handshake is idempotent: one connection, established once", async () => {
    const a = await connect(orgA, `Idem ${RUN}`);
    const r1 = await (await hello(a)).json();
    const r2 = await (await hello(a)).json();
    expect(r1.established).toBe(true);
    expect(r2.established).toBe(false);
    expect(await prisma.agentConnection.count({ where: { agentId: a.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { agentId: a.id, action: "agent.handshake" } })).toBe(1);
  });

  it("an agent that HAS connected is never silently merged with a new attempt of the same name", async () => {
    const a = await connect(orgA, `Live ${RUN}`);
    await hello(a);
    const b = await connect(orgA, `Live ${RUN}`);
    expect(b.id).not.toBe(a.id);
    expect(await state(orgA, a.slug)).toBe("CONNECTED");
    expect(await state(orgA, b.slug)).toBe("WAITING");
  });
});

describe("revoked and expired credentials", () => {
  it("disconnecting revokes the credential", async () => {
    const a = await connect(orgA, `Revoked ${RUN}`);
    await hello(a);
    await disconnectAgentConnection(orgA, userId, a.slug);
    expect((await hello(a)).status).toBe(401);
    expect(await state(orgA, a.slug)).toBe("REVOKED");
  });

  it("an expired credential is rejected and never counts as contact", async () => {
    const a = await connect(orgA, `Expired ${RUN}`);
    await prisma.apiKey.updateMany({ where: { agentId: a.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await hello(a)).status).toBe(401);
    expect(await state(orgA, a.slug)).toBe("ERROR");
  });
});

describe("identity substitution and organization isolation", () => {
  it("the credential decides who is calling, not the body — across organizations and across agents", async () => {
    const victim = await connect(orgA, `Victim ${RUN}`);
    const attacker = await connect(orgB, `Attacker ${RUN}`);
    const res = await hello(attacker, { agent: victim.slug, agentId: victim.id, organizationId: orgA });
    expect(res.status).toBe(200);
    expect((await res.json()).agent.slug).toBe(attacker.slug);
    expect(await state(orgA, victim.slug)).toBe("WAITING");

    const one = await connect(orgA, `AgentOne ${RUN}`);
    const two = await connect(orgA, `AgentTwo ${RUN}`);
    await hello(two, { agent: one.slug, agentId: one.id });
    expect(await state(orgA, two.slug)).toBe("CONNECTED");
    expect(await state(orgA, one.slug)).toBe("WAITING");

    const wide = await createApiKey(orgA, userId, { name: "wide", environment: "LIVE" });
    expect((await post(wide.raw, { agentId: one.id })).status).toBe(403);
    expect(await state(orgA, one.slug)).toBe("WAITING");
  });
});

describe("a questionnaire scan can be linked only to an agent that has really connected", () => {
  it("refuses a record that never made contact, accepts one that did, never across organizations", async () => {
    const pending = await connect(orgA, `Linkable ${RUN}`);
    const scanId = newScanId();
    const base = { organizationId: orgA, userId, agentType: "other", capabilities: [], autonomy: [], controls: {}, engineVersion: "t", score: 0, level: "low", highRiskCount: 0, mediumCount: 0, result: {} };
    await prisma.riskScan.create({ data: { id: scanId, ...base } });
    expect(await linkScanToAgent(orgA, scanId, pending.id)).toBe(false);
    await hello(pending);
    expect(await linkScanToAgent(orgA, scanId, pending.id)).toBe(true);
    expect(await linkScanToAgent(orgB, scanId, pending.id)).toBe(false);
  });
});

describe("retrying Connect for a pending SDK agent at the plan's agent limit", () => {
  it("reuses the pending record instead of saying the limit is reached, and rotates the credential", async () => {
    const names = [`Free One ${RUN}`, `Free Two ${RUN}`, `Free Three ${RUN}`];
    const made: Agent[] = [];
    for (const n of names) made.push(await connect(orgFree, n));
    const fresh = await connectProviderAgent({ organizationId: orgFree, userId, ownerLabel: "t", connectorType: "CUSTOM_SDK", agentName: `Free Four ${RUN}` });
    expect(fresh.ok).toBe(false); // a genuinely NEW agent is still refused at the limit
    expect(await prisma.agent.count({ where: { organizationId: orgFree } })).toBe(3);

    const retry = await connect(orgFree, names[0]);
    expect(retry.id).toBe(made[0].id);
    expect(retry.key).not.toBe(made[0].key);
    expect(await prisma.agent.count({ where: { organizationId: orgFree } })).toBe(3);
    expect((await hello(made[0])).status).toBe(401);
    expect((await hello(retry)).status).toBe(200);

    const connected = await connectProviderAgent({ organizationId: orgFree, userId, ownerLabel: "t", connectorType: "CUSTOM_SDK", agentName: names[0] });
    expect(connected.ok).toBe(false); // already connected: not reused, and at the limit a new one is refused
  });
});
