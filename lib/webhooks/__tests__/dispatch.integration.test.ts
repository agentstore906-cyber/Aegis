/**
 * Integration test against the real dev database, with global `fetch`
 * stubbed so no real network call ever happens — endpoint URLs use a
 * literal public IP (8.8.8.8) so lib/webhooks/ssrf.ts's DNS check
 * resolves instantly and deterministically at creation time too.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhookEndpoint, listWebhookEndpoints, setWebhookEndpointStatus } from "@/lib/webhooks/repository";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { signPayload } from "@/lib/webhooks/crypto";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Webhooks Org", slug: `${RUN_ID}-webhooks` } });
});

afterAll(async () => {
  await prisma.webhookDelivery.deleteMany({ where: { organizationId: org.id } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("event filtering and delivery", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers only to ACTIVE endpoints subscribed to the event, signed with that endpoint's secret", async () => {
    const subscribed = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-subscribed",
      subscribedEvents: ["agent.paused"],
    });
    const wrongEvent = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-wrong-event",
      subscribedEvents: ["approval.approved"],
    });
    const disabled = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-disabled",
      subscribedEvents: ["agent.paused"],
    });
    await setWebhookEndpointStatus(org.id, disabled.endpoint.id, "DISABLED");

    await dispatchWebhookEvent(org.id, "agent.paused", { agentId: "a1", agentName: "Test Agent" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://8.8.8.8/hook-subscribed");
    expect(init.headers["X-Aegis-Event"]).toBe("agent.paused");
    expect(init.headers["X-Aegis-Signature"]).toBe(signPayload(subscribed.secret, init.body as string));

    const deliveries = await prisma.webhookDelivery.findMany({ where: { organizationId: org.id } });
    expect(deliveries.filter((d) => d.webhookEndpointId === subscribed.endpoint.id)).toHaveLength(1);
    expect(deliveries.filter((d) => d.webhookEndpointId === wrongEvent.endpoint.id)).toHaveLength(0);
    expect(deliveries.filter((d) => d.webhookEndpointId === disabled.endpoint.id)).toHaveLength(0);
  });

  it("redacts secret-shaped keys in the delivered payload", async () => {
    const endpoint = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-redact",
      subscribedEvents: ["cost.anomaly.detected"],
    });

    await dispatchWebhookEvent(org.id, "cost.anomaly.detected", { agentId: "a1", apiKey: "should-not-appear" });

    const [, init] = fetchMock.mock.calls.find(
      (call) => call[0] === "https://8.8.8.8/hook-redact"
    ) as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.data.apiKey).toBe("[REDACTED]");

    await setWebhookEndpointStatus(org.id, endpoint.endpoint.id, "DISABLED");
  });

  it("retries on 5xx up to the bounded attempt count, and stops immediately on 4xx", async () => {
    const serverError = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-500",
      subscribedEvents: ["security.alert.created"],
    });
    fetchMock.mockResolvedValue(new Response("error", { status: 500 }));

    await dispatchWebhookEvent(org.id, "security.alert.created", { id: "alert-1" });

    const serverErrorDeliveries = await prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: serverError.endpoint.id },
      orderBy: { attempt: "asc" },
    });
    expect(serverErrorDeliveries).toHaveLength(3); // 1 initial + 2 retries, all FAILED
    expect(serverErrorDeliveries.every((d) => d.status === "FAILED")).toBe(true);

    fetchMock.mockClear();
    const clientError = await createWebhookEndpoint(org.id, null, {
      url: "https://8.8.8.8/hook-400",
      subscribedEvents: ["security.alert.created"],
    });
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));

    await dispatchWebhookEvent(org.id, "security.alert.created", { id: "alert-2" });

    const clientErrorDeliveries = await prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: clientError.endpoint.id },
    });
    expect(clientErrorDeliveries).toHaveLength(1); // never retried
  });

  it("never returns the secret from listWebhookEndpoints", async () => {
    const rows = await listWebhookEndpoints(org.id);
    for (const row of rows) {
      expect("secret" in row).toBe(false);
    }
  });
});
