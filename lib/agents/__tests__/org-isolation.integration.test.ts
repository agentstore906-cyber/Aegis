/**
 * Organization isolation, proven against a real database with two organizations, two users and agents that
 * deliberately SHARE a slug. Every function the console's pages and server actions call is exercised as
 * Organization A against Organization B's data, and Organization B's rows are re-read afterwards to prove nothing
 * changed. Nothing here trusts that earlier UI work left isolation intact.
 *
 * Needs DATABASE_URL_TEST (guarded: lib/testing/test-db-guard.ts). The optional HTTP checks run only when
 * AEGIS_E2E_BASE_URL points at a server using the same disposable database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { connectProviderAgent, disconnectAgentConnection, reconnectAgentConnection, checkConnectionHealth, AgentConnectionNotFoundError } from "@/lib/agents/connection-service";
import { AgentNotFoundError, setAgentControlState } from "@/lib/agents/control";
import { getAgentBySlug, listAgents } from "@/lib/agents/queries";
import { getAgentListSignals, getOpenAlertCounts } from "@/lib/agents/list-signals";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { agentFiltersSchema } from "@/lib/validation/agent";

const RUN = `iso_${Date.now()}`;
const BASE = process.env.AEGIS_E2E_BASE_URL;

type Side = { orgId: string; userId: string; agentId: string; slug: string; key: string };
let A: Side;
let B: Side;

async function side(tag: string): Promise<Side> {
  const user = await prisma.user.create({ data: { email: `${RUN}-${tag}@example.com`, name: `Iso ${tag}` } });
  const org = await prisma.organization.create({ data: { name: `Iso ${tag}`, slug: `${RUN}-${tag}`, plan: "enterprise" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  // The SAME name, therefore the same slug, in both organizations.
  const r = await connectProviderAgent({ organizationId: org.id, userId: user.id, ownerLabel: "iso", connectorType: "CUSTOM_SDK", agentName: "Support Agent" });
  if (!r.ok || !r.apiKeyRaw) throw new Error("setup failed");
  await prisma.securityAlert.create({
    data: { organizationId: org.id, agentId: r.agentId, type: "POLICY_VIOLATION_DETECTED", severity: "HIGH", title: `alert ${tag}`, description: "isolation fixture" } as never,
  });
  return { orgId: org.id, userId: user.id, agentId: r.agentId, slug: r.agentSlug, key: r.apiKeyRaw };
}

beforeAll(async () => {
  A = await side("a");
  B = await side("b");
});

afterAll(async () => {
  // Evidence tables are append-only by trigger, so the fixtures stay in the disposable test database.
  await prisma.$disconnect();
});

describe("same slug, two organizations", () => {
  it("fixture: both agents share a slug but are different rows", () => {
    expect(A.slug).toBe(B.slug);
    expect(A.agentId).not.toBe(B.agentId);
  });

  it("reads resolve only the caller's own agent", async () => {
    expect((await getAgentBySlug(A.orgId, A.slug))?.id).toBe(A.agentId);
    expect((await getAgentBySlug(B.orgId, B.slug))?.id).toBe(B.agentId);
    const listedByA = await listAgents(A.orgId, agentFiltersSchema.parse({}));
    expect(listedByA.agents.map((a) => a.id)).toEqual([A.agentId]);
  });

  it("list signals and open-alert counts ignore another organization's agent ids", async () => {
    // A asks about B's agent id while presenting A's organization: nothing may come back.
    expect((await getAgentListSignals(A.orgId, [B.agentId])).size).toBe(1); // a row is built per requested id…
    const crossed = (await getAgentListSignals(A.orgId, [B.agentId])).get(B.agentId)!;
    expect(crossed.connection.state).toBe("WAITING"); // …but from NO evidence: B's connection and key are not read
    expect(crossed.connection.lastSeenAt).toBeNull();
    expect((await getOpenAlertCounts(A.orgId, [B.agentId])).size).toBe(0);
    expect((await getOpenAlertCounts(A.orgId, [A.agentId])).get(A.agentId)).toBe(1);
    expect((await getOpenAlertCounts(B.orgId, [B.agentId])).get(B.agentId)).toBe(1);
  });

  it("the connection snapshot is per organization", async () => {
    const snap = await getAgentConnectionSnapshot(A.orgId, A.slug);
    expect(snap?.agent.id).toBe(A.agentId);
    expect(await getAgentConnectionSnapshot(A.orgId, "no-such-agent")).toBeNull();
  });
});

describe("Organization A cannot modify Organization B", () => {
  it("disconnect / reconnect / health-check by slug act on A's agent only, never B's", async () => {
    const bBefore = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: B.agentId } });

    // Organization A has no agent called "ghost", and the same-slug agent in B must not be reachable by any route.
    await expect(disconnectAgentConnection(A.orgId, A.userId, "ghost")).rejects.toThrow(AgentConnectionNotFoundError);
    await expect(reconnectAgentConnection(A.orgId, A.userId, "ghost")).rejects.toThrow(AgentConnectionNotFoundError);
    await expect(checkConnectionHealth(A.orgId, "ghost")).rejects.toThrow(AgentConnectionNotFoundError);
    await expect(setAgentControlState(A.orgId, "ghost", "PAUSED", A.userId)).rejects.toThrow(AgentNotFoundError);

    // The same slug, acted on as A, changes A and leaves B byte-for-byte alone.
    await setAgentControlState(A.orgId, A.slug, "PAUSED", A.userId);
    await disconnectAgentConnection(A.orgId, A.userId, A.slug);

    const bAfter = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: B.agentId } });
    const bAgent = await prisma.agent.findUniqueOrThrow({ where: { id: B.agentId } });
    expect(bAgent.status).toBe("ACTIVE");
    expect(bAfter.status).toBe(bBefore.status);
    expect(bAfter.disconnectedAt).toBeNull();
    const bKey = await prisma.apiKey.findMany({ where: { organizationId: B.orgId } });
    expect(bKey.length).toBeGreaterThan(0);
    expect(bKey.every((k) => k.revokedAt === null)).toBe(true);

    const aAgent = await prisma.agent.findUniqueOrThrow({ where: { id: A.agentId } });
    expect(aAgent.status).toBe("PAUSED");
    expect((await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: A.agentId } })).status).toBe("DISCONNECTED");
  });

  it("every audit event written for A's changes belongs to A", async () => {
    const leaked = await prisma.auditEvent.count({ where: { organizationId: B.orgId, actorUserId: A.userId } });
    expect(leaked).toBe(0);
  });
});

describe.skipIf(!BASE)("HTTP: credentials and anonymous callers", () => {
  const call = (path: string, key?: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) } });

  it("anonymous requests fail closed with 401, not data", async () => {
    for (const [path, method] of [
      ["/api/v1/agents", "GET"],
      ["/api/v1/events", "POST"],
      ["/api/v1/evaluate", "POST"],
      ["/api/v1/connect/handshake", "POST"],
    ] as const) {
      const res = await call(path, undefined, { method, body: method === "POST" ? "{}" : undefined });
      expect(res.status, path).toBe(401);
    }
    const status = await fetch(`${BASE}/api/agents/${A.slug}/connection`, { redirect: "manual" });
    expect([401, 307, 308]).toContain(status.status);
  });

  it("a garbage or truncated credential is rejected", async () => {
    expect((await call("/api/v1/connect/handshake", "aegis_live_not-a-real-key", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("B's credential cannot read or act on A's agent: the identity comes from the credential, never the request", async () => {
    // Even naming A's agent in the body, B's key can only ever be B's agent.
    const res = await call("/api/v1/connect/handshake", B.key, { method: "POST", body: JSON.stringify({ agentId: A.agentId, organizationId: A.orgId, agentSlug: A.slug }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent?: { slug?: string } };
    expect(body.agent?.slug).toBe(B.slug);
    const bConn = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: B.agentId } });
    expect(bConn.firstHandshakeAt).not.toBeNull();
    expect((await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: A.agentId } })).firstHandshakeAt).toBeNull();
  });

  it("A's revoked credential (disconnected above) is refused", async () => {
    expect((await call("/api/v1/connect/handshake", A.key, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await call("/api/v1/events", A.key, { method: "POST", body: JSON.stringify({ eventType: "TOOL_CALL", action: "x.y" }) })).status).toBe(401);
  });
});
