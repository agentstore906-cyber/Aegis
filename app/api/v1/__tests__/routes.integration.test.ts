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

import { POST as eventsPost } from "@/app/api/v1/events/route";
import { POST as evaluatePost } from "@/app/api/v1/evaluate/route";
import { GET as approvalsGet } from "@/app/api/v1/approvals/[id]/route";
import { POST as registerPost } from "@/app/api/v1/agents/register/route";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string; slug: string };
let agentB: { id: string; slug: string };
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

  const created = await createApiKey(orgA.id, null, { name: "Routes test key", environment: "TEST" });
  rawKeyA = created.raw;
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  // SecurityAlert.agent is onDelete: Restrict (Phase 6) — clear any
  // alerts the detectors created during evaluation before deleting agents.
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
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
});

describe("POST /api/v1/evaluate", () => {
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
