/**
 * Integration tests against the real dev database, modeled on the
 * project's other *.integration.test.ts files. Next.js route handlers
 * (the POST/GET exports of a route.ts file) are plain async functions
 * that take a standard Request and return a Response — they're imported
 * and invoked directly here, no running server required.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";

import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";
import { GET as approvalsGet } from "@/app/api/v1/approvals/[id]/route";
import { POST as registerHandler } from "@/app/api/v1/agents/register/route";

// The non-dynamic v1 route handlers ignore the route context Next.js passes
// as the second argument, but its type is still required. Supply the empty
// context here so these can be invoked directly with just a Request.
const emptyRouteContext = { params: Promise.resolve<Record<string, string>>({}) };
const eventsPost = (request: Request) => eventsHandler(request, emptyRouteContext);
const evaluatePost = (request: Request) => evaluateHandler(request, emptyRouteContext);
const registerPost = (request: Request) => registerHandler(request, emptyRouteContext);

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string; slug: string };
let agentB: { id: string; slug: string };
let disconnectedAgent: { id: string; slug: string };
let rawKeyA: string;

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { authorization: `Bearer ${rawKeyA}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "API Routes Org A", slug: `${RUN_ID}-routes-a` } });
  orgB = await prisma.organization.create({ data: { name: "API Routes Org B", slug: `${RUN_ID}-routes-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Routes Test Agent",
      slug: "routes-test-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentB = await prisma.agent.create({
    data: {
      organizationId: orgB.id,
      name: "Routes Test Agent B",
      slug: "routes-test-agent-b",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  await prisma.agentPermission.createMany({
    data: [
      { organizationId: orgA.id, agentId: agentA.id, action: "invoice.read", resource: "", decision: "ALLOW" },
      { organizationId: orgA.id, agentId: agentA.id, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" },
    ],
  });

  disconnectedAgent = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Disconnected Test Agent",
      slug: "disconnected-test-agent",
      owner: "Test",
      modelProvider: "Custom Agent",
      modelName: "unknown",
    },
  });
  await prisma.agentConnection.create({
    data: {
      organizationId: orgA.id,
      agentId: disconnectedAgent.id,
      connectorType: "CUSTOM_SDK",
      status: "DISCONNECTED",
      disconnectedAt: new Date(),
      capabilities: { agentDiscovery: false, activityMonitoring: true, usageMonitoring: false, costMonitoring: false, pauseAgent: false, killSwitch: false, credentialVerification: false },
    },
  });

  const created = await createApiKey(orgA.id, null, { name: "Routes test key", environment: "TEST" });
  rawKeyA = created.raw;
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  // SecurityAlert.agent is onDelete: Restrict (Phase 6) — clear any
  // alerts the detectors created during evaluation before deleting agents.
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const request = new Request("http://localhost/api/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read" }),
    });
    const response = await eventsPost(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_API_KEY");
  });

  it("rejects an unrecognized key", async () => {
    const request = new Request("http://localhost/api/v1/events", {
      method: "POST",
      headers: { authorization: "Bearer aegis_live_" + "z".repeat(32), "content-type": "application/json" },
      body: JSON.stringify({ agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read" }),
    });
    const response = await eventsPost(request);
    expect(response.status).toBe(401);
  });

  it("attaches an x-aegis-request-id header even on success", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", { agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read" })
    );
    expect(response.headers.get("x-aegis-request-id")).toBeTruthy();
  });
});

describe("POST /api/v1/events", () => {
  it("rejects an agent that belongs to a different organization", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", { agent: agentB.slug, eventType: "TOOL_CALL", action: "invoice.read" })
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
  });

  it("rejects activity for an agent whose connection was disconnected", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", { agent: disconnectedAgent.slug, eventType: "TOOL_CALL", action: "invoice.read" })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("AGENT_CONNECTION_DISCONNECTED");

    const count = await prisma.activityEvent.count({ where: { agentId: disconnectedAgent.id } });
    expect(count).toBe(0);
  });

  it("rejects a malformed payload", async () => {
    const response = await eventsPost(jsonRequest("/api/v1/events", { agent: agentA.slug }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("stores an ActivityEvent for a valid payload", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "TOOL_CALL",
        action: "invoice.read",
        resource: "invoice:inv_1",
        status: "SUCCESS",
        cost: 0.02,
        model: "gpt-5",
        provider: "openai",
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: body.id } });
    expect(event.agentId).toBe(agentA.id);
    expect(event.status).toBe("ALLOWED");
    expect(event.modelName).toBe("gpt-5");
    expect(event.costCents).toBe(2);
  });

  it("stores tool, description, and computes risk from the action/resource, not the request", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "DATA_ACCESS",
        action: "crm.export",
        resource: "customer_list",
        description: "Nightly customer list export",
        tool: "CRM",
        status: "SUCCESS",
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: body.id } });
    expect(event.toolName).toBe("CRM");
    expect(event.description).toBe("Nightly customer list export");
    // export + a customer-shaped resource -> CRITICAL, regardless of the
    // agent's own static riskLevel (LOW by default in this fixture) — the
    // request has no riskLevel field at all, it's always computed server-side.
    expect(event.riskLevel).toBe("CRITICAL");
  });

  it("accepts BLOCKED and WARNING as self-reported statuses", async () => {
    const blockedResponse = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "ACTION",
        action: "refund.issue",
        status: "BLOCKED",
      })
    );
    expect(blockedResponse.status).toBe(201);
    const blockedBody = await blockedResponse.json();
    const blockedEvent = await prisma.activityEvent.findUniqueOrThrow({ where: { id: blockedBody.id } });
    expect(blockedEvent.status).toBe("BLOCKED");

    const warningResponse = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "ACTION",
        action: "docs.read",
        status: "WARNING",
      })
    );
    expect(warningResponse.status).toBe(201);
    const warningBody = await warningResponse.json();
    const warningEvent = await prisma.activityEvent.findUniqueOrThrow({ where: { id: warningBody.id } });
    expect(warningEvent.status).toBe("WARNING");
  });

  it("rejects a request body over the size limit", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "TOOL_CALL",
        action: "invoice.read",
        metadata: { blob: "x".repeat(64 * 1024) },
      })
    );
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects metadata containing a nested prototype-pollution key", async () => {
    // Built via JSON.parse, not an object literal: `{ __proto__: {...} }` as
    // a literal invokes the prototype-setter rather than creating an own,
    // JSON-serializable key. JSON.parse (like a real attacker's raw HTTP
    // body) makes "__proto__" a genuine own property instead. Nested one
    // level deep (not top-level) because `eventIngestSchema`'s
    // `z.record(z.string(), z.unknown())` step harmlessly absorbs a
    // top-level "__proto__" key on its own (it never round-trips anywhere);
    // a nested one passes through that shallow step untouched and is what
    // lib/policies/safe-context.ts's UNSAFE_KEYS check exists to catch.
    const metadata = JSON.parse('{"nested": {"__proto__": {"polluted": true}}}');
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "TOOL_CALL",
        action: "invoice.read",
        metadata,
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects metadata nested deeper than the safe-context depth limit", async () => {
    const deeplyNested = { a: { b: { c: { d: { e: "too deep" } } } } };
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "TOOL_CALL",
        action: "invoice.read",
        metadata: deeplyNested,
      })
    );
    expect(response.status).toBe(400);
  });

  it("redacts secret-shaped metadata keys before persisting", async () => {
    const response = await eventsPost(
      jsonRequest("/api/v1/events", {
        agent: agentA.slug,
        eventType: "TOOL_CALL",
        action: "invoice.read",
        metadata: { apiKey: "sk_live_should_never_be_stored", note: "fine" },
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: body.id } });
    const metadata = event.metadata as Record<string, unknown>;
    expect(metadata.apiKey).toBe("[REDACTED]");
    expect(metadata.note).toBe("fine");
  });
});

describe("POST /api/v1/evaluate", () => {
  it("rejects an authorization request for a disconnected agent", async () => {
    const response = await evaluatePost(
      jsonRequest("/api/v1/evaluate", { agent: disconnectedAgent.slug, action: "invoice.read" })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("AGENT_CONNECTION_DISCONNECTED");
  });

  it("returns ALLOW for a permitted action", async () => {
    const response = await evaluatePost(jsonRequest("/api/v1/evaluate", { agent: agentA.slug, action: "invoice.read" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe("ALLOW");
    expect(body.evaluationId).toBeTruthy();
    expect(body.traceId).toBeTruthy();
  });

  it("returns BLOCK with a safe reason for an unconfigured action", async () => {
    const response = await evaluatePost(
      jsonRequest("/api/v1/evaluate", { agent: agentA.slug, action: "customer.delete" })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe("BLOCK");
    expect(typeof body.reason).toBe("string");
    expect(body.reason).not.toMatch(/at \S+\.(ts|js):\d+/); // never a stack trace
  });

  it("returns REQUIRE_APPROVAL with a resolvable approvalRequestId", async () => {
    const response = await evaluatePost(
      jsonRequest("/api/v1/evaluate", {
        agent: agentA.slug,
        action: "refund.issue",
        context: { amount: 250 },
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe("REQUIRE_APPROVAL");
    expect(body.approvalRequestId).toBeTruthy();

    const approvalResponse = await approvalsGet(
      new Request(`http://localhost/api/v1/approvals/${body.approvalRequestId}`, {
        headers: { authorization: `Bearer ${rawKeyA}` },
      }),
      { params: Promise.resolve({ id: body.approvalRequestId }) }
    );
    expect(approvalResponse.status).toBe(200);
    const approvalBody = await approvalResponse.json();
    expect(approvalBody.status).toBe("PENDING");
    expect(approvalBody.decision).toBeNull();
  });
});

describe("GET /api/v1/approvals/:id — organization scoping", () => {
  it("returns APPROVAL_NOT_FOUND for a request belonging to another organization", async () => {
    const evalResponse = await evaluatePost(
      jsonRequest("/api/v1/evaluate", { agent: agentA.slug, action: "refund.issue", context: { amount: 99 } })
    );
    const { approvalRequestId } = await evalResponse.json();

    const otherOrgKey = await createApiKey(orgB.id, null, { name: "Org B key", environment: "TEST" });
    const response = await approvalsGet(
      new Request(`http://localhost/api/v1/approvals/${approvalRequestId}`, {
        headers: { authorization: `Bearer ${otherOrgKey.raw}` },
      }),
      { params: Promise.resolve({ id: approvalRequestId }) }
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("APPROVAL_NOT_FOUND");
  });
});

describe("Idempotency-Key", () => {
  it("replays the original response for a repeated key with an equivalent body", async () => {
    const payload = { agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read", resource: "idem-test" };
    const idempotencyKey = `idem_${RUN_ID}_1`;

    const first = await eventsPost(jsonRequest("/api/v1/events", payload, { "idempotency-key": idempotencyKey }));
    const firstBody = await first.json();

    const second = await eventsPost(jsonRequest("/api/v1/events", payload, { "idempotency-key": idempotencyKey }));
    const secondBody = await second.json();

    expect(secondBody.id).toBe(firstBody.id);

    const count = await prisma.activityEvent.count({ where: { id: firstBody.id } });
    expect(count).toBe(1);
  });

  it("rejects the same key reused with a different body", async () => {
    const idempotencyKey = `idem_${RUN_ID}_2`;
    await eventsPost(
      jsonRequest(
        "/api/v1/events",
        { agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read", resource: "a" },
        { "idempotency-key": idempotencyKey }
      )
    );

    const conflict = await eventsPost(
      jsonRequest(
        "/api/v1/events",
        { agent: agentA.slug, eventType: "TOOL_CALL", action: "invoice.read", resource: "b" },
        { "idempotency-key": idempotencyKey }
      )
    );

    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });
});

describe("POST /api/v1/agents/register", () => {
  it("creates an agent, then upserts on a repeated call with the same name", async () => {
    const first = await registerPost(jsonRequest("/api/v1/agents/register", { name: `Register Test ${RUN_ID}` }));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.created).toBe(true);

    const second = await registerPost(jsonRequest("/api/v1/agents/register", { name: `Register Test ${RUN_ID}` }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.created).toBe(false);
    expect(secondBody.id).toBe(firstBody.id);
  });
});

describe("rate limiting", () => {
  it("returns 429 once a key exceeds its request budget", async () => {
    const { raw } = await createApiKey(orgA.id, null, { name: "Rate limit test key", environment: "TEST" });
    const makeRequest = () =>
      registerPost(
        new Request("http://localhost/api/v1/agents/register", {
          method: "POST",
          headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" },
          body: JSON.stringify({ name: `Rate Limited Agent ${RUN_ID}` }),
        })
      );

    let lastResponse: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      lastResponse = await makeRequest();
    }

    expect(lastResponse?.status).toBe(429);
    const body = await lastResponse?.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(lastResponse?.headers.get("retry-after")).toBeTruthy();
  });
});
