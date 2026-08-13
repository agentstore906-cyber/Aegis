import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { signPayload } from "@/lib/webhooks/crypto";
import { assertSafeWebhookUrl } from "@/lib/webhooks/ssrf";
import type { WebhookEventType } from "@/lib/webhooks/types";

export { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/types";
export type { WebhookEventType } from "@/lib/webhooks/types";

const DELIVERY_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3; // 1 initial attempt + 2 bounded retries
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delivers an event to every ACTIVE endpoint subscribed to it. Best-effort
 * and immediate — NOT a durable queue, since no background-job
 * infrastructure exists in this environment (spec §26/§56). A process
 * restart mid-retry drops that delivery; every attempt (success or
 * failure) is logged to WebhookDelivery so gaps are at least visible, not
 * silent. See docs/webhooks.md.
 *
 * Never throws — a webhook failure must never break the flow (approval
 * resolution, alert creation, agent pause, ...) that triggered it.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await dispatchUnsafe(organizationId, eventType, data);
  } catch (error) {
    console.error(JSON.stringify({ msg: "webhook_dispatch_failed", organizationId, eventType, error: String(error) }));
  }
}

async function dispatchUnsafe(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, status: "ACTIVE", subscribedEvents: { has: eventType } },
  });
  if (endpoints.length === 0) return;

  const payload = {
    event: eventType,
    apiVersion: "2026-08-12",
    createdAt: new Date().toISOString(),
    data: redactSecrets(data),
  };
  const rawBody = JSON.stringify(payload);

  await Promise.all(
    endpoints.map((endpoint) =>
      deliverToEndpoint(
        { id: endpoint.id, organizationId: endpoint.organizationId, url: endpoint.url, secret: endpoint.secret },
        eventType,
        rawBody,
        payload
      )
    )
  );
}

async function deliverToEndpoint(
  endpoint: { id: string; organizationId: string; url: string; secret: string },
  eventType: string,
  rawBody: string,
  payload: unknown
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const outcome = await attemptDelivery(endpoint, eventType, rawBody, payload, attempt);
    if (outcome === "stop") return;
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
  }
}

async function attemptDelivery(
  endpoint: { id: string; organizationId: string; url: string; secret: string },
  eventType: string,
  rawBody: string,
  payload: unknown,
  attempt: number
): Promise<"stop" | "retry"> {
  const logDelivery = (status: "SUCCESS" | "FAILED", httpStatus?: number) =>
    prisma.webhookDelivery.create({
      data: {
        webhookEndpointId: endpoint.id,
        organizationId: endpoint.organizationId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        status,
        httpStatus,
        attempt,
      },
    });

  try {
    // Re-checked immediately before every attempt — DNS answers can change between creation and delivery.
    await assertSafeWebhookUrl(endpoint.url);
    const signature = signPayload(endpoint.secret, rawBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Aegis-Signature": signature,
          "X-Aegis-Event": eventType,
        },
        body: rawBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    await logDelivery(response.ok ? "SUCCESS" : "FAILED", response.status);

    if (response.ok) return "stop";
    if (response.status < 500) return "stop"; // 4xx is the receiver's problem, not worth retrying
    return "retry";
  } catch {
    await logDelivery("FAILED");
    return "retry";
  }
}
