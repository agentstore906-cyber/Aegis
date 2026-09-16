/**
 * Integration test against the real dev database, modeled on
 * lib/agents/__tests__/control.integration.test.ts. Covers the Connect
 * Agent architecture (lib/agents/connection-service.ts) — provider
 * verification, discovery, connect/reconnect/disconnect, health checks,
 * organization isolation, entitlements, and the truthfulness rules
 * (capabilities, no fake agents, no fake activity). Provider HTTP calls
 * (OpenAI/Anthropic) are mocked at the global `fetch` level, the same
 * technique packages/agent-sdk/__tests__/client.test.ts uses.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  connectProviderAgent,
  discoverProviderConnection,
  checkConnectionHealth,
  reconnectAgentConnection,
  disconnectAgentConnection,
  AgentConnectionNotFoundError,
} from "@/lib/agents/connection-service";
import { openaiConnector } from "@/lib/connectors/openai";
import { anthropicConnector } from "@/lib/connectors/anthropic";
import { customConnector } from "@/lib/connectors/custom";

const RUN_ID = `test_${Date.now()}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let org: { id: string };
let user: { id: string };
let limitedOrg: { id: string };
let apiKeyLimitOrg: { id: string };

beforeAll(async () => {
  // "enterprise" (unlimited agent/API-key limits) so the functional tests
  // below aren't gated by plan entitlements — those are covered separately
  // by limitedOrg, which is deliberately kept on "free".
  org = await prisma.organization.create({ data: { name: "Connect Org", slug: `${RUN_ID}-org`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Connector Tester" } });

  // A separate org, pre-filled to the free plan's agent limit (3), for the
  // entitlement test — kept isolated so it never interferes with counts in
  // the other tests below.
  limitedOrg = await prisma.organization.create({ data: { name: "Limited Org", slug: `${RUN_ID}-limited`, plan: "free" } });
  for (let i = 0; i < 3; i++) {
    await prisma.agent.create({
      data: { organizationId: limitedOrg.id, name: `Filler ${i}`, slug: `filler-${i}`, owner: "Test", modelProvider: "Custom Agent", modelName: "unknown" },
    });
  }

  // Free plan's apiKeyLimit (2), agent limit untouched — isolated from
  // limitedOrg so the two entitlement tests can't interfere with each other.
  apiKeyLimitOrg = await prisma.organization.create({ data: { name: "API Key Limit Org", slug: `${RUN_ID}-apikey-limit`, plan: "free" } });
});

afterAll(async () => {
  const orgIds = [org.id, limitedOrg.id, apiKeyLimitOrg.id];
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connector capabilities are truthful", () => {
  it("OpenAI never claims usage/cost sync or enforcement it doesn't have", () => {
    expect(openaiConnector.capabilities).toMatchObject({
      agentDiscovery: true,
      credentialVerification: true,
      usageMonitoring: false,
      costMonitoring: false,
      pauseAgent: false,
      killSwitch: false,
    });
  });

  it("Anthropic never claims agent discovery — no such API exists", () => {
    expect(anthropicConnector.capabilities.agentDiscovery).toBe(false);
  });

  it("Anthropic discoverAgents always returns an empty list, never a fabricated one", async () => {
    const agents = await anthropicConnector.discoverAgents({ organizationId: org.id, credential: "sk-ant-whatever" });
    expect(agents).toEqual([]);
  });

  it("Custom connector has no third-party credential to verify", () => {
    expect(customConnector.capabilities.credentialVerification).toBe(false);
    expect(customConnector.capabilities.agentDiscovery).toBe(false);
  });
});

describe("connectProviderAgent — CUSTOM_SDK", () => {
  it("connects, auto-provisions an API key, and never fabricates activity", async () => {
    const result = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "CUSTOM_SDK",
      agentName: "Custom Ops Agent",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apiKeyRaw).toMatch(/^aegis_live_/);

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: result.agentId }, include: { connection: true } });
    expect(agent.modelProvider).toBe("Custom Agent");
    expect(agent.connection?.connectorType).toBe("CUSTOM_SDK");
    expect(agent.connection?.status).toBe("CONNECTED");
    expect(agent.connection?.credentialCiphertext).toBeNull();
    expect(agent.connection?.apiKeyId).not.toBeNull();

    const activityCount = await prisma.activityEvent.count({ where: { agentId: agent.id } });
    expect(activityCount).toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: agent.id, eventType: "agent.connected" },
    });
    expect(audit).not.toBeNull();
  });

  it("requires a name — never invents one", async () => {
    const result = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "CUSTOM_SDK",
    });
    expect(result.ok).toBe(false);
  });

  it("still connects when the API key limit is reached, but flags it instead of fabricating a key", async () => {
    // Free plan's apiKeyLimit is 2 — fill it first.
    await prisma.apiKey.create({ data: { organizationId: apiKeyLimitOrg.id, name: "filler-1", environment: "LIVE", prefix: "aegis_live_f1", keyHash: `${RUN_ID}-f1` } });
    await prisma.apiKey.create({ data: { organizationId: apiKeyLimitOrg.id, name: "filler-2", environment: "LIVE", prefix: "aegis_live_f2", keyHash: `${RUN_ID}-f2` } });

    const result = await connectProviderAgent({
      organizationId: apiKeyLimitOrg.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "CUSTOM_SDK",
      agentName: "Key-Limited Agent",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apiKeyRaw).toBeUndefined();
    expect(result.apiKeyLimitReached).toBe(true);
  });
});

describe("connectProviderAgent — OPENAI", () => {
  it("auto-connects when discovery finds exactly one assistant, using its real name/model", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [{ id: "asst_1", name: "Sales Agent", model: "gpt-4.1" }] });
      return jsonResponse({}, 404);
    });

    const result = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-single",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: result.agentId }, include: { connection: true } });
    expect(agent.name).toBe("Sales Agent");
    expect(agent.modelName).toBe("gpt-4.1");
    expect(agent.modelProvider).toBe("OpenAI");
    expect(agent.connection?.externalAgentId).toBe("asst_1");
    expect(agent.connection?.externalAccountLabel).toMatch(/\.\.\./);
    expect(agent.connection?.credentialCiphertext).not.toBeNull();
  });

  it("asks the caller to choose when discovery finds multiple assistants, then connects the chosen one", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (/\/v1\/assistants\/asst_multi_2$/.test(url)) return jsonResponse({ id: "asst_multi_2", name: "Support Agent", model: "gpt-4.1-mini" });
      if (url.includes("/v1/assistants?")) {
        return jsonResponse({
          data: [
            { id: "asst_multi_1", name: "Sales Agent", model: "gpt-4.1" },
            { id: "asst_multi_2", name: "Support Agent", model: "gpt-4.1-mini" },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const first = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-multi",
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect("needsSelection" in first).toBe(true);
    if (!("needsSelection" in first)) return;
    expect(first.agents).toHaveLength(2);

    const second = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-multi",
      selectedExternalId: "asst_multi_2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.agentName).toBe("Support Agent");
  });

  it("asks for a name when discovery finds no assistants at all", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [] });
      return jsonResponse({}, 404);
    });

    const withoutName = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-empty",
    });
    expect(withoutName.ok).toBe(false);

    const withName = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-empty",
      agentName: "Manually Named Agent",
    });
    expect(withName.ok).toBe(true);
  });

  it("reports a rejected credential with a safe, non-leaking message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_api_key" }, 401));

    const result = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-bad",
    });

    expect(result.ok).toBe(false);
    if (result.ok || "needsSelection" in result) return;
    expect(result.error).toBe("The provider rejected the connection.");
  });

  it("refuses to connect once the organization is at its agent limit", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [] });
      return jsonResponse({}, 404);
    });

    const result = await connectProviderAgent({
      organizationId: limitedOrg.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-test-limit",
      agentName: "One Too Many",
    });

    expect(result.ok).toBe(false);
    if (result.ok || "needsSelection" in result) return;
    expect(result.error).toMatch(/plan/i);
  });
});

describe("connectProviderAgent — ANTHROPIC", () => {
  it("has no discovery API — always requires a name, never invents one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const withoutName = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "ANTHROPIC",
      credential: "sk-ant-1",
    });
    expect(withoutName.ok).toBe(false);

    const withName = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "ANTHROPIC",
      credential: "sk-ant-1",
      agentName: "Research Agent",
    });
    expect(withName.ok).toBe(true);
    if (!withName.ok) return;

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: withName.agentId }, include: { connection: true } });
    expect(agent.modelProvider).toBe("Anthropic");
    expect(agent.connection?.externalAgentId).toBeNull();
  });
});

describe("discoverProviderConnection — read-only, no persistence", () => {
  it("creates no database rows", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [{ id: "asst_discover_only", name: "Ephemeral", model: "gpt-4.1" }] });
      return jsonResponse({}, 404);
    });

    const before = await prisma.agent.count({ where: { organizationId: org.id } });
    const result = await discoverProviderConnection(org.id, "OPENAI", "sk-discover-only");
    const after = await prisma.agent.count({ where: { organizationId: org.id } });

    expect(result.ok).toBe(true);
    expect(after).toBe(before);
  });
});

describe("organization isolation", () => {
  it("never resolves a connection belonging to a different organization", async () => {
    const created = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "CUSTOM_SDK",
      agentName: "Isolation Test Agent",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(disconnectAgentConnection(limitedOrg.id, user.id, created.agentSlug)).rejects.toThrow(
      AgentConnectionNotFoundError
    );
    await expect(reconnectAgentConnection(limitedOrg.id, user.id, created.agentSlug)).rejects.toThrow(
      AgentConnectionNotFoundError
    );
    await expect(checkConnectionHealth(limitedOrg.id, created.agentSlug)).rejects.toThrow(AgentConnectionNotFoundError);
  });
});

describe("health check, reconnect, and disconnect", () => {
  it("full lifecycle for an OpenAI connection: degrade, reconnect with a new key, disconnect", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [{ id: "asst_lifecycle", name: "Lifecycle Agent", model: "gpt-4.1" }] });
      if (/\/v1\/assistants\/asst_lifecycle$/.test(url)) return jsonResponse({ id: "asst_lifecycle", name: "Lifecycle Agent", model: "gpt-4.1" });
      return jsonResponse({}, 404);
    });

    const connected = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-lifecycle-1",
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;

    // Health check succeeds while the key is still valid.
    const healthy = await checkConnectionHealth(org.id, connected.agentSlug);
    expect(healthy.ok).toBe(true);
    expect(healthy.status).toBe("CONNECTED");

    // The key gets revoked at the provider — health check must reflect that truthfully.
    fetchMock.mockResolvedValue(jsonResponse({ error: "revoked" }, 401));
    const degraded = await checkConnectionHealth(org.id, connected.agentSlug);
    expect(degraded.ok).toBe(false);
    expect(degraded.status).toBe("RECONNECT_REQUIRED");

    // Reconnecting with a fresh, valid key restores CONNECTED.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (/\/v1\/assistants\/asst_lifecycle$/.test(url)) return jsonResponse({ id: "asst_lifecycle", name: "Lifecycle Agent", model: "gpt-4.1" });
      return jsonResponse({}, 404);
    });
    const reconnected = await reconnectAgentConnection(org.id, user.id, connected.agentSlug, "sk-lifecycle-2");
    expect(reconnected.ok).toBe(true);

    const afterReconnect = await prisma.agentConnection.findUniqueOrThrow({
      where: { agentId: connected.agentId },
    });
    expect(afterReconnect.status).toBe("CONNECTED");
    expect(afterReconnect.credentialCiphertext).not.toBeNull();

    const reconnectAudit = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: connected.agentId, eventType: "agent.reconnected" },
    });
    expect(reconnectAudit).not.toBeNull();

    // Disconnect stops ingestion (see the AGENT_CONNECTION_DISCONNECTED gate
    // in app/api/v1/events/route.ts) and discards the stored credential,
    // but keeps historical data.
    await disconnectAgentConnection(org.id, user.id, connected.agentSlug);
    const afterDisconnect = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: connected.agentId } });
    expect(afterDisconnect.status).toBe("DISCONNECTED");
    expect(afterDisconnect.credentialCiphertext).toBeNull();
    expect(afterDisconnect.credentialIv).toBeNull();
    expect(afterDisconnect.credentialAuthTag).toBeNull();

    const disconnectAudit = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: connected.agentId, eventType: "agent.disconnected" },
    });
    expect(disconnectAudit).not.toBeNull();

    const agentStillExists = await prisma.agent.findUnique({ where: { id: connected.agentId } });
    expect(agentStillExists).not.toBeNull();
  });

  it("rejects reconnecting with a key that doesn't own the originally connected assistant", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (url.includes("/v1/assistants?")) return jsonResponse({ data: [{ id: "asst_owned", name: "Owned Agent", model: "gpt-4.1" }] });
      if (/\/v1\/assistants\/asst_owned$/.test(url)) return jsonResponse({ id: "asst_owned", name: "Owned Agent", model: "gpt-4.1" });
      return jsonResponse({}, 404);
    });

    const connected = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "OPENAI",
      credential: "sk-owner-1",
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;

    // A different, validly-authenticating key that has no access to the
    // originally connected assistant (404 on that specific id).
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) return jsonResponse({ data: [] });
      if (/\/v1\/assistants\/asst_owned$/.test(url)) return jsonResponse({}, 404);
      return jsonResponse({}, 404);
    });

    const result = await reconnectAgentConnection(org.id, user.id, connected.agentSlug, "sk-unrelated-account");
    expect(result.ok).toBe(false);
  });

  it("CUSTOM_SDK reconnect rotates the API key and revokes the old one", async () => {
    const connected = await connectProviderAgent({
      organizationId: org.id,
      userId: user.id,
      ownerLabel: "Tester",
      connectorType: "CUSTOM_SDK",
      agentName: "Rotation Test Agent",
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;

    const before = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: connected.agentId } });
    const oldKeyId = before.apiKeyId;
    expect(oldKeyId).not.toBeNull();

    const reconnected = await reconnectAgentConnection(org.id, user.id, connected.agentSlug);
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(reconnected.apiKeyRaw).toMatch(/^aegis_live_/);

    const after = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: connected.agentId } });
    expect(after.apiKeyId).not.toBe(oldKeyId);

    const oldKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: oldKeyId! } });
    expect(oldKey.revokedAt).not.toBeNull();
  });
});
