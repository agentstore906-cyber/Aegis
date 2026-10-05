/**
 * END-TO-END: a REAL external agent process against a REAL running Aegis server.
 *
 * Opt-in. It needs a running server and a disposable database, so it is skipped unless
 *   AEGIS_E2E_BASE_URL=http://localhost:3100   (a server started with DATABASE_URL = the test database)
 * is set, in addition to DATABASE_URL_TEST (the usual integration-test guard). See docs/AEGIS_CONNECT_AGENT_AUDIT.md.
 *
 * What is NOT faked: the connection state. Nothing here writes AgentConnection / ActivityEvent rows or marks
 * anything connected — every such row is produced by the server handling a real HTTP request from `scripts/e2e/real-agent.mjs`
 * (a separate process using the published SDK). Test scaffolding that is allowed: the organization/user rows, the
 * policy under test, and revoking/expiring a key to test rejection.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { connectProviderAgent, disconnectAgentConnection, reconnectAgentConnection } from "@/lib/agents/connection-service";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { createApiKey } from "@/lib/api-keys/repository";

const BASE = process.env.AEGIS_E2E_BASE_URL;
const RUN = `e2e_${Date.now()}`;

type AgentOutput = {
  ok: boolean;
  error?: unknown;
  handshake: { connected: boolean; established: boolean; agent: { slug: string } };
  event: { duplicate: boolean };
  allowed: { decision: string };
  enforcement: {
    decision: string;
    guardedToolRan: boolean;
    guardedBlocked: { name: string } | null;
    ignoringAgentToolRan: boolean;
  };
};
type Agent = { id: string; slug: string; key: string };
let userId: string;
let orgA: string;
let orgB: string;
let a1: Agent;
let a2: Agent;
let b1: Agent;
const orgIds: string[] = [];

async function connect(organizationId: string, name: string): Promise<Agent> {
  const r = await connectProviderAgent({ organizationId, userId, ownerLabel: "e2e", connectorType: "CUSTOM_SDK", agentName: name });
  if (!r.ok) throw new Error("error" in r ? r.error : "needs selection");
  if (!r.apiKeyRaw) throw new Error("no credential issued");
  return { id: r.agentId, slug: r.agentSlug, key: r.apiKeyRaw };
}

function api(path: string, key: string | null, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

function runAgent(agent: Agent, extraEnv: Record<string, string> = {}): Promise<AgentOutput> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [resolve("scripts/e2e/real-agent.mjs")], {
      env: { ...process.env, AEGIS_BASE_URL: BASE!, AEGIS_API_KEY: agent.key, AEGIS_AGENT: agent.slug, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", () => {
      try {
        res(JSON.parse(stdout.trim().split("\n").pop()!));
      } catch {
        rej(new Error(`agent produced no JSON. stdout=${stdout} stderr=${stderr}`));
      }
    });
  });
}

const snapshot = (org: string, slug: string) => getAgentConnectionSnapshot(org, slug);

describe.skipIf(!BASE)("Connect Agent — real external agent, real server", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `${RUN}@example.com`, name: "E2E" } });
    userId = user.id;
    const [A, B] = await Promise.all([
      prisma.organization.create({ data: { name: "E2E A", slug: `${RUN}-a`, plan: "enterprise" } }),
      prisma.organization.create({ data: { name: "E2E B", slug: `${RUN}-b`, plan: "enterprise" } }),
    ]);
    orgA = A.id;
    orgB = B.id;
    orgIds.push(orgA, orgB);
    // Aegis denies unconfigured actions by default (DEFAULT_DENY), so the org allows the one action the agent uses.
    await prisma.policy.create({ data: { organizationId: orgA, name: "e2e allow lookup", decision: "ALLOW", action: "crm.lookup", status: "ACTIVE" } });
    await prisma.policy.create({ data: { organizationId: orgB, name: "e2e allow lookup", decision: "ALLOW", action: "crm.lookup", status: "ACTIVE" } });
    a1 = await connect(orgA, "Support Agent");
    a2 = await connect(orgA, "Research Agent");
    b1 = await connect(orgB, "Support Agent"); // SAME name/slug as a1, different organization
  });

  afterAll(async () => {
    // Evidence tables are append-only by trigger; the test organizations (and so their evidence) are left in the
    // disposable test database rather than deleted.
    await prisma.$disconnect();
  });

  it("is WAITING — not connected — until the agent itself makes contact", async () => {
    const s = await snapshot(orgA, a1.slug);
    expect(s!.view.state).toBe("WAITING");
    expect(s!.view.steps.find((x) => x.key === "connection")!.done).toBe(false);
    const row = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: a1.id } });
    expect(row.firstHandshakeAt).toBeNull();
    expect(row.status).toBe("CONNECTING");
  });

  it("rejects unauthenticated, malformed and unknown credentials", async () => {
    for (const key of [null, "nope", "aegis_live_" + "x".repeat(32)]) {
      const res = await api("/api/v1/connect/handshake", key, {});
      expect(res.status).toBe(401);
    }
    expect((await snapshot(orgA, a1.slug))!.view.state).toBe("WAITING");
  });

  it("an organization-wide key cannot handshake (it cannot say WHICH agent is calling)", async () => {
    const wide = await createApiKey(orgA, userId, { name: "wide", environment: "LIVE" });
    const res = await api("/api/v1/connect/handshake", wide.raw, {});
    expect(res.status).toBe(403);
    expect((await snapshot(orgA, a1.slug))!.view.state).toBe("WAITING");
  });

  it("REAL AGENT: handshake → first event → decision, recognised as the correct agent", async () => {
    const out = await runAgent(a1);
    expect(out.error).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(out.handshake).toMatchObject({ connected: true, established: true, agent: { slug: a1.slug } });
    expect(out.event.duplicate).toBe(false);
    expect(out.allowed.decision).toBe("ALLOW");

    const conn = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: a1.id } });
    expect(conn.status).toBe("CONNECTED");
    expect(conn.firstHandshakeAt).not.toBeNull();
    expect(conn.lastSeenAt).not.toBeNull();

    const handshakes = await prisma.auditEvent.count({ where: { organizationId: orgA, agentId: a1.id, action: "agent.handshake" } });
    expect(handshakes).toBe(1);

    const events = await prisma.activityEvent.findMany({ where: { agentId: a1.id, action: "crm.lookup" } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.organizationId === orgA && e.agentId === a1.id)).toBe(true);

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: a1.id } });
    expect(agent.lastActiveAt).not.toBeNull();
    expect(agent.sdkVersion).toBe("e2e");

    const s = await snapshot(orgA, a1.slug);
    expect(s!.view.state).toBe("CONNECTED");
    expect(s!.view.monitoring).toBe("RECEIVING");
    // Honest about what it is: the agent asked for decisions, Aegis is not in its data path.
    expect(s!.view.protection).toBe("ASKS_FOR_DECISIONS");
    expect(s!.view.protectionLabel).not.toMatch(/protected/i);
  });

  it("a repeated handshake is idempotent (one audit event, still established=false)", async () => {
    const res = await api("/api/v1/connect/handshake", a1.key, {});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.established).toBe(false);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgA, agentId: a1.id, action: "agent.handshake" } })).toBe(1);
  });

  it("idempotency: the same Idempotency-Key twice is ONE event, and a different body is a 409", async () => {
    const body = { agent: a1.slug, eventType: "ACTION", action: "idem.test", status: "SUCCESS" };
    const h = { "idempotency-key": `${RUN}-idem` };
    const r1 = await api("/api/v1/events", a1.key, body, h);
    const r2 = await api("/api/v1/events", a1.key, body, h);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201); // replayed original response
    expect((await r1.json()).id).toBe((await r2.json()).id);
    expect(await prisma.activityEvent.count({ where: { agentId: a1.id, action: "idem.test" } })).toBe(1);
    const r3 = await api("/api/v1/events", a1.key, { ...body, action: "idem.other" }, h);
    expect(r3.status).toBe(409);
    expect(await prisma.activityEvent.count({ where: { agentId: a1.id, action: "idem.other" } })).toBe(0);
  });

  it("idempotency: the same clientEventId is ONE logical event (retry without an Idempotency-Key)", async () => {
    const body = { agent: a1.slug, eventType: "ACTION", action: "cid.test", status: "SUCCESS", clientEventId: `${RUN}-cid` };
    const r1 = await api("/api/v1/events", a1.key, body);
    const r2 = await api("/api/v1/events", a1.key, body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
    expect(await prisma.activityEvent.count({ where: { agentId: a1.id, clientEventId: `${RUN}-cid` } })).toBe(1);
  });

  it("the server derives the agent from the credential: no agent identifier is needed, and none can be spoofed", async () => {
    // The real agent above never sent one. Raw requests too: omitted → the key's own agent.
    const omitted = await api("/api/v1/events", a1.key, { eventType: "ACTION", action: "derived.identity", status: "SUCCESS" });
    expect(omitted.status).toBe(201);
    const row = await prisma.activityEvent.findFirstOrThrow({ where: { action: "derived.identity", organizationId: orgA } });
    expect(row.agentId).toBe(a1.id);
    // Naming another agent is rejected, not honoured.
    const spoof = await api("/api/v1/events", a1.key, { agent: a2.slug, eventType: "ACTION", action: "derived.spoof", status: "SUCCESS" });
    expect(spoof.status).toBe(403);
    // An organization-wide key cannot say who is calling, so it must name an agent.
    const wide = await createApiKey(orgA, userId, { name: "wide-2", environment: "LIVE" });
    const noName = await api("/api/v1/events", wide.raw, { eventType: "ACTION", action: "derived.wide", status: "SUCCESS" });
    expect(noName.status).toBe(400);
    expect((await noName.json()).error.code).toBe("AGENT_REQUIRED");
    expect(await prisma.activityEvent.count({ where: { action: { in: ["derived.spoof", "derived.wide"] } } })).toBe(0);
  });

  it("heartbeat: a later handshake refreshes lastSeenAt (after the once-a-minute write window)", async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    // Time travel only: pretend the last contact was 10 minutes ago. Nothing is marked connected here.
    await prisma.agentConnection.update({ where: { agentId: a1.id }, data: { lastSeenAt: past } });
    const res = await api("/api/v1/connect/handshake", a1.key, {});
    expect(res.status).toBe(200);
    const conn = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: a1.id } });
    expect(conn.lastSeenAt!.getTime()).toBeGreaterThan(past.getTime() + 9 * 60 * 1000);
    expect(conn.status).toBe("CONNECTED");
  });

  it("agent isolation: Agent A's credential cannot act as Agent B", async () => {
    const before = await prisma.activityEvent.count({ where: { agentId: a2.id } });
    const ev = await api("/api/v1/events", a1.key, { agent: a2.slug, eventType: "ACTION", action: "impersonate", status: "SUCCESS" });
    expect(ev.status).toBe(403);
    expect((await ev.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    const evaluate = await api("/api/v1/evaluate", a1.key, { agent: a2.slug, action: "impersonate" });
    expect(evaluate.status).toBe(403);
    const register = await api("/api/v1/agents/register", a1.key, { name: "Brand New Agent" });
    expect(register.status).toBe(403);
    expect(await prisma.activityEvent.count({ where: { agentId: a2.id } })).toBe(before);
    expect(await prisma.agent.count({ where: { organizationId: orgA, name: "Brand New Agent" } })).toBe(0);
    // Agent 2 has still never been contacted: Agent 1's activity did not connect it.
    expect((await snapshot(orgA, a2.slug))!.view.state).toBe("WAITING");
  });

  it("identity cannot be changed through the request body (organizationId / agentId are ignored)", async () => {
    const res = await api("/api/v1/events", a1.key, {
      agent: a1.slug,
      eventType: "ACTION",
      action: "smuggle",
      status: "SUCCESS",
      organizationId: orgB,
      agentId: b1.id,
    });
    // Accepted or rejected, it may only ever land on Agent 1 in Org A.
    if (res.status === 201) {
      const e = await prisma.activityEvent.findFirstOrThrow({ where: { action: "smuggle", organizationId: { in: [orgA, orgB] } } });
      expect(e.agentId).toBe(a1.id);
      expect(e.organizationId).toBe(orgA);
    } else {
      expect(res.status).toBe(400);
    }
    expect(await prisma.activityEvent.count({ where: { organizationId: orgB, action: "smuggle" } })).toBe(0);
  });

  it("organization isolation: a credential from Org A cannot reach Org B's agent, even with the same slug", async () => {
    expect(b1.slug).toBe(a1.slug);
    const res = await api("/api/v1/events", a1.key, { agent: b1.slug, eventType: "ACTION", action: "xorg", status: "SUCCESS" });
    expect(res.status).toBe(201); // resolved inside ORG A's namespace — it is Agent 1 of Org A
    expect(await prisma.activityEvent.count({ where: { agentId: b1.id } })).toBe(0);
    expect((await snapshot(orgB, b1.slug))!.view.state).toBe("WAITING");
    // Org B's own agent, in Org B, works and is recognised separately.
    const out = await runAgent(b1);
    expect(out.ok).toBe(true);
    expect((await snapshot(orgB, b1.slug))!.view.state).toBe("CONNECTED");
    expect(await prisma.activityEvent.count({ where: { agentId: b1.id, organizationId: orgB } })).toBeGreaterThan(0);
    // Org A's cross-org attempt never touched Org B's data; and Org B's key can't name an Org A-only agent.
    const miss = await api("/api/v1/events", b1.key, { agent: a2.slug, eventType: "ACTION", action: "xorg2", status: "SUCCESS" });
    expect(miss.status).toBe(404);
  });

  it("an expired credential is rejected", async () => {
    const k = await createApiKey(orgA, userId, { name: "short", environment: "LIVE", agentId: a1.id });
    await prisma.apiKey.update({ where: { id: k.apiKey.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api("/api/v1/events", k.raw, { agent: a1.slug, eventType: "ACTION", action: "expired", status: "SUCCESS" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("EXPIRED_API_KEY");
  });

  it("a policy BLOCK stops a guarded tool call; an agent that ignores the decision is NOT stopped", async () => {
    await prisma.policy.create({ data: { organizationId: orgA, name: "e2e block", decision: "BLOCK", action: "crm.delete", status: "ACTIVE" } });
    const out = await runAgent(a1, { AEGIS_BLOCKED_ACTION: "crm.delete" });
    expect(out.ok).toBe(true);
    expect(out.enforcement.decision).toBe("BLOCK");
    expect(out.enforcement.guardedToolRan).toBe(false); // enforcement only inside guard()
    expect(out.enforcement.guardedBlocked?.name).toBe("AegisBlockedError");
    expect(out.enforcement.ignoringAgentToolRan).toBe(true); // Aegis cannot stop a caller that ignores the decision
    const evals = await prisma.policyEvaluation.findMany({ where: { agentId: a1.id, action: "crm.delete" } });
    expect(evals.length).toBeGreaterThanOrEqual(2);
    expect(evals.every((e) => e.decision === "BLOCK")).toBe(true);
  });

  it("DISCONNECT revokes the credential and stops ingestion; history stays", async () => {
    const eventsBefore = await prisma.activityEvent.count({ where: { agentId: a1.id } });
    await disconnectAgentConnection(orgA, userId, a1.slug);
    expect((await snapshot(orgA, a1.slug))!.view.state).toBe("REVOKED");
    const res = await api("/api/v1/events", a1.key, { agent: a1.slug, eventType: "ACTION", action: "after.disconnect", status: "SUCCESS" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("REVOKED_API_KEY");
    expect((await api("/api/v1/connect/handshake", a1.key, {})).status).toBe(401);
    expect(await prisma.activityEvent.count({ where: { agentId: a1.id } })).toBe(eventsBefore);
  });

  it("a DIFFERENT still-valid key bound to the disconnected agent is refused too", async () => {
    const other = await createApiKey(orgA, userId, { name: "second key", environment: "LIVE", agentId: a1.id });
    const ev = await api("/api/v1/events", other.raw, { agent: a1.slug, eventType: "ACTION", action: "after.disconnect.2", status: "SUCCESS" });
    expect(ev.status).toBe(409);
    expect((await api("/api/v1/evaluate", other.raw, { agent: a1.slug, action: "crm.lookup" })).status).toBe(409);
    expect((await api("/api/v1/connect/handshake", other.raw, {})).status).toBe(409);
    expect(await prisma.activityEvent.count({ where: { agentId: a1.id, action: { startsWith: "after.disconnect" } } })).toBe(0);
    await prisma.apiKey.update({ where: { id: other.apiKey.id }, data: { revokedAt: new Date() } });
  });

  it("RECONNECT keeps the same agent, issues a new credential, is WAITING until real contact, and the old key stays dead", async () => {
    const oldKey = a1.key;
    const r = await reconnectAgentConnection(orgA, userId, a1.slug);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.apiKeyRaw) throw new Error("no new credential");
    a1 = { ...a1, key: r.apiKeyRaw };

    expect((await snapshot(orgA, a1.slug))!.view.state).toBe("WAITING"); // not CONNECTED just because someone clicked reconnect
    expect((await api("/api/v1/events", oldKey, { agent: a1.slug, eventType: "ACTION", action: "old.key", status: "SUCCESS" })).status).toBe(401);

    const out = await runAgent(a1);
    expect(out.ok).toBe(true);
    expect(out.handshake.established).toBe(true);
    expect((await snapshot(orgA, a1.slug))!.view.state).toBe("CONNECTED");

    // Same identity, history intact.
    expect(await prisma.agent.count({ where: { organizationId: orgA, slug: a1.slug } })).toBe(1);
    const history = await prisma.activityEvent.count({ where: { agentId: a1.id, action: "crm.lookup" } });
    expect(history).toBeGreaterThanOrEqual(2); // before and after the disconnect
  });

  it("a second and third agent connect independently; activity never crosses", async () => {
    const out2 = await runAgent(a2);
    expect(out2.ok).toBe(true);
    const a3 = await connect(orgA, "Billing Agent");
    expect((await snapshot(orgA, a3.slug))!.view.state).toBe("WAITING");
    const out3 = await runAgent(a3);
    expect(out3.ok).toBe(true);
    for (const a of [a1, a2, a3]) {
      const evs = await prisma.activityEvent.findMany({ where: { agentId: a.id }, select: { organizationId: true, agentId: true } });
      expect(evs.length).toBeGreaterThan(0);
      expect(evs.every((e) => e.agentId === a.id && e.organizationId === orgA)).toBe(true);
    }
    expect((await snapshot(orgA, a2.slug))!.view.state).toBe("CONNECTED");
    expect((await snapshot(orgA, a3.slug))!.view.state).toBe("CONNECTED");
  });

  it("Free plan: every agent the plan allows can actually be connected (each gets its own credential)", async () => {
    const free = await prisma.organization.create({ data: { name: "E2E Free", slug: `${RUN}-free`, plan: "free" } });
    orgIds.push(free.id);
    const results = [];
    for (const name of ["One", "Two", "Three"]) {
      results.push(await connectProviderAgent({ organizationId: free.id, userId, ownerLabel: "e2e", connectorType: "CUSTOM_SDK", agentName: name }));
    }
    expect(results.every((r) => r.ok)).toBe(true);
    // The plan allows 3 agents; each of them must be connectable.
    expect(results.map((r) => (r.ok ? Boolean(r.apiKeyRaw) : false))).toEqual([true, true, true]);
  });
});
