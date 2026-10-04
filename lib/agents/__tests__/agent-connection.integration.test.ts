/**
 * The agent connection lifecycle through the real route handlers and services, against the verified
 * disposable test database: issue credential → waiting → handshake → connected → activity → revoke →
 * reconnect (rotation). Connection success must come from backend evidence, never from creating the agent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { connectProviderAgent, disconnectAgentConnection, reconnectAgentConnection } from "@/lib/agents/connection-service";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { POST as handshakeHandler } from "@/app/api/v1/connect/handshake/route";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const RUN_ID = `test_conn_${Date.now()}`;

let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };

const post = (path: string, key: string | null, body: unknown = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const handshake = (key: string | null, body: unknown = {}) => handshakeHandler(post("/api/v1/connect/handshake", key, body), ctx);
const track = (key: string, agent: string, action = "crm.read") =>
  eventsHandler(post("/api/v1/events", key, { agent, eventType: "TOOL_CALL", action }), ctx);

async function connect(name: string, organizationId = org.id, environment?: "STAGING") {
  const result = await connectProviderAgent({ organizationId, userId: user.id, ownerLabel: "Tester", connectorType: "CUSTOM_SDK", agentName: name, environment });
  if (!result.ok || !("apiKeyRaw" in result) || !result.apiKeyRaw) throw new Error("connect failed");
  return { slug: result.agentSlug, id: result.agentId, key: result.apiKeyRaw };
}
const snapshot = async (slug: string, organizationId = org.id) => (await getAgentConnectionSnapshot(organizationId, slug))!;
const handshakeAudits = (agentId: string) => prisma.auditEvent.count({ where: { agentId, eventType: "agent.handshake" } });

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Conn", slug: `${RUN_ID}-org`, plan: "enterprise" } });
  otherOrg = await prisma.organization.create({ data: { name: "Conn Other", slug: `${RUN_ID}-other`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.test`, name: "T" } });
}, 60_000);

afterAll(async () => {
  const orgIds = [org.id, otherOrg.id];
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

describe("creating a connection does not connect it", () => {
  it("issues an agent-bound credential and leaves the agent WAITING with nothing claimed", async () => {
    const a = await connect("Support Agent", org.id, "STAGING");
    const row = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: a.id } });
    expect(row.status).toBe("CONNECTING");
    expect(row.firstHandshakeAt).toBeNull();
    expect(row.lastSeenAt).toBeNull();

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } });
    expect(agent.environment).toBe("STAGING");

    const key = await prisma.apiKey.findUniqueOrThrow({ where: { id: row.apiKeyId! } });
    expect(key.agentId).toBe(a.id); // agent-scoped
    expect(key.organizationId).toBe(org.id); // org-scoped
    expect(key.revokedAt).toBeNull();
    expect(key.keyHash).not.toContain(a.key); // stored hashed, never as the raw secret
    expect(key.scopes).not.toContain("agents:read");
    expect(key.scopes).not.toContain("policy:simulate");

    const s = await snapshot(a.slug);
    expect(s.view.state).toBe("WAITING");
    expect(s.view.steps.every((step) => !step.done)).toBe(true);
    expect(s.view.monitoring).toBe("NONE");
    expect(s.eventsObserved).toBe(0);
    expect(s.baseline).toBeNull();
    expect(await handshakeAudits(a.id)).toBe(0);
  });
});

describe("handshake", () => {
  it("rejects a missing, malformed and unknown credential without touching any connection", async () => {
    const a = await connect("Hs Reject");
    expect((await handshake(null)).status).toBe(401);
    expect((await handshake("not-a-key")).status).toBe(401);
    expect((await handshake("aegis_live_" + "0".repeat(40))).status).toBe(401);
    expect((await snapshot(a.slug)).view.state).toBe("WAITING");
  });

  it("requires a key bound to an agent: an organization-wide key cannot say which agent is calling", async () => {
    const a = await connect("Hs Wide");
    const wide = await createApiKey(org.id, null, { name: "wide", environment: "TEST" });
    const response = await handshake(wide.raw);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    expect((await snapshot(a.slug)).view.state).toBe("WAITING");
  });

  it("a valid handshake establishes the connection, once, with a single audit event", async () => {
    const a = await connect("Hs Valid");
    const response = await handshake(a.key, { sdkVersion: "1.2.3", framework: "LangChain" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ connected: true, established: true, agent: { slug: a.slug } });

    const s = await snapshot(a.slug);
    expect(s.view.state).toBe("CONNECTED");
    expect(s.view.steps.map((x) => [x.key, x.done])).toEqual([
      ["identity", true],
      ["connection", true],
      ["activity", false], // a handshake is not activity
    ]);
    expect(s.view.monitoring).toBe("NONE");
    expect(s.view.protection).toBe("MONITORING_ONLY");
    expect(await handshakeAudits(a.id)).toBe(1);

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } });
    expect(agent.sdkVersion).toBe("1.2.3");
    expect(agent.framework).toBe("LangChain");
  });

  it("is idempotent: a duplicate or replayed handshake records nothing new", async () => {
    const a = await connect("Hs Dup");
    const first = await (await handshake(a.key)).json();
    const replay = await (await handshake(a.key)).json();
    const third = await (await handshake(a.key)).json();
    expect(first.established).toBe(true);
    expect(replay.established).toBe(false);
    expect(third.established).toBe(false);
    expect(replay.firstHandshakeAt).toBe(first.firstHandshakeAt);
    expect(await handshakeAudits(a.id)).toBe(1);
  });

  it("concurrent first handshakes establish exactly one connection", async () => {
    const a = await connect("Hs Race");
    const responses = await Promise.all(Array.from({ length: 6 }, () => handshake(a.key)));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.filter((b) => b.established).length).toBe(1);
    expect(await handshakeAudits(a.id)).toBe(1);
  });

  it("rejects an oversized or malformed body", async () => {
    const a = await connect("Hs Body");
    expect((await handshake(a.key, { sdkVersion: "x".repeat(100) })).status).toBe(400);
    const bad = await handshakeHandler(new Request("http://localhost/api/v1/connect/handshake", { method: "POST", headers: { authorization: `Bearer ${a.key}` }, body: "{nope" }), ctx);
    expect(bad.status).toBe(400);
  });

  it("is rate limited per key like every other agent endpoint", async () => {
    const a = await connect("Hs Rate");
    let last: Response | undefined;
    for (let i = 0; i < 61; i += 1) last = await handshake(a.key);
    expect(last?.status).toBe(429);
    expect((await last!.json()).error.code).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("activity is the other proof of contact", () => {
  it("an agent that simply starts reporting is recognised, truthfully, with monitoring and last-seen", async () => {
    const a = await connect("Reports First");
    expect((await track(a.key, a.slug)).status).toBe(201);
    const s = await snapshot(a.slug);
    expect(s.view.state).toBe("CONNECTED");
    expect(s.view.monitoring).toBe("RECEIVING");
    expect(s.view.steps.every((step) => step.done)).toBe(true);
    expect(s.eventsObserved).toBe(1);
    expect(s.view.lastSeenAt).not.toBeNull();
    expect(await handshakeAudits(a.id)).toBe(1);
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } });
    expect(agent.lastActiveAt).not.toBeNull();
  });

  it("asking for a decision is what moves protection from 'monitoring only' to 'asks for decisions'", async () => {
    const a = await connect("Asks Decisions");
    await prisma.agentPermission.create({ data: { organizationId: org.id, agentId: a.id, action: "invoice.read", resource: "", decision: "ALLOW" } });
    await track(a.key, a.slug);
    expect((await snapshot(a.slug)).view.protection).toBe("MONITORING_ONLY");
    const evaluated = await evaluateHandler(post("/api/v1/evaluate", a.key, { agent: a.slug, action: "invoice.read" }), ctx);
    expect(evaluated.status).toBe(200);
    const s = await snapshot(a.slug);
    expect(s.view.protection).toBe("ASKS_FOR_DECISIONS");
    expect(s.view.protectionLabel).not.toMatch(/protected/i);
  });
});

describe("agent and tenant isolation", () => {
  it("a credential for agent A can neither act as agent B nor connect it", async () => {
    const a = await connect("Iso A");
    const b = await connect("Iso B");
    const response = await track(a.key, b.slug);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    expect((await snapshot(b.slug)).view.state).toBe("WAITING");
    expect((await snapshot(b.slug)).eventsObserved).toBe(0);
  });

  it("a credential from another organization is no credential here, and snapshots never cross tenants", async () => {
    const mine = await connect("Iso Mine");
    const theirs = await connect("Iso Theirs", otherOrg.id);
    const cross = await track(theirs.key, mine.slug);
    expect(cross.status).toBe(404); // the slug resolves only inside the KEY's organization, so another tenant's agent does not exist for it
    expect((await cross.json()).error.code).toBe("AGENT_NOT_FOUND");
    expect((await snapshot(mine.slug)).view.state).toBe("WAITING");
    expect(await getAgentConnectionSnapshot(otherOrg.id, mine.slug)).toBeNull();
    expect(await getAgentConnectionSnapshot(org.id, theirs.slug)).toBeNull();
  });

  it("the same agent slug in two organizations keeps separate connection state", async () => {
    const x = await connect("Same Slug Agent");
    const y = await connect("Same Slug Agent", otherOrg.id);
    expect(x.slug).toBe(y.slug);
    await handshake(x.key);
    expect((await snapshot(x.slug, org.id)).view.state).toBe("CONNECTED");
    expect((await snapshot(y.slug, otherOrg.id)).view.state).toBe("WAITING");
  });
});

describe("revocation, reconnection and rotation", () => {
  it("disconnecting revokes immediately, keeps history, and the old credential stops working", async () => {
    const a = await connect("Revoke Me");
    await track(a.key, a.slug);
    await handshake(a.key);
    expect((await snapshot(a.slug)).view.state).toBe("CONNECTED");

    await disconnectAgentConnection(org.id, user.id, a.slug);

    const s = await snapshot(a.slug);
    expect(s.view.state).toBe("REVOKED");
    expect(s.view.reason).toBeTruthy();
    // History is preserved.
    expect(s.eventsObserved).toBe(1);
    expect(await prisma.activityEvent.count({ where: { agentId: a.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { agentId: a.id, eventType: "agent.handshake" } })).toBe(1);

    for (const response of [await handshake(a.key), await track(a.key, a.slug)]) {
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("REVOKED_API_KEY");
    }
  });

  it("a revoked key is REVOKED even if only the key was revoked (Developers > API keys)", async () => {
    const a = await connect("Key Revoked Elsewhere");
    await handshake(a.key);
    const row = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: a.id } });
    await prisma.apiKey.update({ where: { id: row.apiKeyId! }, data: { revokedAt: new Date() } });
    expect((await snapshot(a.slug)).view.state).toBe("REVOKED");
  });

  it("reconnecting keeps the identity and history, issues a new credential, and waits again until it is used", async () => {
    const a = await connect("Reconnect Me");
    await track(a.key, a.slug);
    const firstContact = (await snapshot(a.slug)).view.firstHandshakeAt;
    await disconnectAgentConnection(org.id, user.id, a.slug);

    const result = await reconnectAgentConnection(org.id, user.id, a.slug);
    expect(result.ok).toBe(true);
    const fresh = (result as { apiKeyRaw?: string }).apiKeyRaw!;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(a.key);

    // Same agent, same history, but not connected until the new credential is actually used.
    const waiting = await snapshot(a.slug);
    expect(waiting.agent.id).toBe(a.id);
    expect(waiting.eventsObserved).toBe(1);
    expect(waiting.view.state).toBe("WAITING");
    expect(waiting.view.steps.find((s) => s.key === "connection")?.done).toBe(false);

    // The old credential is dead; the new one connects.
    expect((await handshake(a.key)).status).toBe(401);
    const hs = await handshake(fresh);
    expect(hs.status).toBe(200);
    expect((await hs.json()).established).toBe(true);
    const connected = await snapshot(a.slug);
    expect(connected.view.state).toBe("CONNECTED");
    expect(connected.view.firstHandshakeAt?.getTime()).toBe(firstContact?.getTime()); // original identity evidence kept
  });

  it("rotating a connected agent's credential revokes the old one at once and waits for the new one", async () => {
    const a = await connect("Rotate Me");
    await handshake(a.key);
    const result = await reconnectAgentConnection(org.id, user.id, a.slug);
    const fresh = (result as { apiKeyRaw?: string }).apiKeyRaw!;
    expect((await handshake(a.key)).status).toBe(401);
    expect((await snapshot(a.slug)).view.state).toBe("WAITING");
    expect((await handshake(fresh)).status).toBe(200);
    expect((await snapshot(a.slug)).view.state).toBe("CONNECTED");
    const audits = await prisma.auditEvent.findMany({ where: { agentId: a.id, eventType: { in: ["agent.reconnected", "agent.handshake"] } } });
    expect(audits.map((x) => x.eventType).sort()).toEqual(["agent.handshake", "agent.handshake", "agent.reconnected"]);
  });

  it("never stores or logs the raw credential in audit metadata", async () => {
    const a = await connect("No Secrets");
    await handshake(a.key);
    const audits = await prisma.auditEvent.findMany({ where: { agentId: a.id } });
    expect(JSON.stringify(audits)).not.toContain(a.key);
  });
});

describe("agents that predate connection records", () => {
  it("a handshake from an API-registered agent creates its connection record from real evidence", async () => {
    const agent = await prisma.agent.create({ data: { organizationId: org.id, name: "Legacy", slug: "legacy-agent", owner: "T", modelProvider: "x", modelName: "y" } });
    const { raw } = await createApiKey(org.id, null, { name: "legacy", environment: "TEST", agentId: agent.id });
    expect((await snapshot("legacy-agent")).hasConnectionRecord).toBe(false);
    expect((await snapshot("legacy-agent")).view.state).toBe("WAITING");
    expect((await handshake(raw)).status).toBe(200);
    const s = await snapshot("legacy-agent");
    expect(s.hasConnectionRecord).toBe(true);
    expect(s.view.state).toBe("CONNECTED");
  });
});
