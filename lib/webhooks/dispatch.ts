import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { canCreateWebhook } from "@/lib/billing/entitlements";
import { redactSecrets } from "@/lib/security/redact";
import { signPayload } from "@/lib/webhooks/crypto";
import { postWebhook } from "@/lib/webhooks/safe-post";
import { defer } from "@/lib/server/defer";
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
 * Schedules delivery of an event to every ACTIVE endpoint subscribed to it,
 * AFTER the current response is sent (lib/server/defer.ts). Delivery —
 * including its bounded retries, up to ~16s against a slow endpoint — used
 * to run inline, which stalled POST /api/v1/evaluate behind a customer's
 * webhook receiver. A webhook is a notification, never part of the
 * security decision, so it never sits on the decision path now.
 *
 * Still best-effort, NOT a durable queue (no background-job infrastructure
 * exists yet — docs/AEGIS_P0_IMPLEMENTATION.md §9). Every attempt (success
 * or failure) is logged to WebhookDelivery so gaps stay visible.
 *
 * Never throws and never blocks on delivery — a webhook failure must never
 * break the flow (approval resolution, alert creation, agent pause, ...)
 * that triggered it. The payload is snapshotted (redacted) synchronously.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const snapshot = redactSecrets(data);
  const createdAt = new Date().toISOString();
  defer(`webhook:${eventType}`, async () => {
    try {
      await dispatchUnsafe(organizationId, eventType, snapshot, createdAt);
    } catch (error) {
      console.error(JSON.stringify({ msg: "webhook_dispatch_failed", organizationId, eventType, error: String(error) }));
    }
  });
}

/**
 * Whether the organization's CURRENT plan includes outbound webhooks (`PLANS[plan].webhooks`: Startup and above, the same
 * rule that gates creating an endpoint and that the pricing page derives its claim from). Read from the database at
 * delivery time, so a downgrade, cancellation or pause stops delivery even for endpoints created while the plan allowed
 * them. Fails CLOSED: a missing organization, an unrecognized plan string (`getPlan` maps it to Free) or a lookup error
 * all mean "do not deliver". A webhook is a best-effort notification (see `dispatchWebhookEvent`), so skipping one during a
 * database fault costs a notification, never a security decision. Logs ids and error class only: no URL, secret or payload.
 */
async function webhooksEntitled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
    return organization !== null && canCreateWebhook(organization.plan).allowed;
  } catch (error) {
    console.error(
      JSON.stringify({ msg: "webhook_entitlement_check_failed", organizationId, errorName: error instanceof Error ? error.name : "UnknownError" })
    );
    return false;
  }
}

async function dispatchUnsafe(
  organizationId: string,
  eventType: WebhookEventType,
  data: unknown,
  createdAt: string
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, status: "ACTIVE", subscribedEvents: { has: eventType } },
  });
  if (endpoints.length === 0) return;

  if (!(await webhooksEntitled(organizationId))) {
    console.warn(JSON.stringify({ msg: "webhook_delivery_skipped_plan", organizationId, eventType, endpoints: endpoints.length }));
    return;
  }

  const payload = {
    event: eventType,
    apiVersion: "2026-08-12",
    createdAt,
    data,
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
    // The first attempt follows the entitlement check in `dispatchUnsafe`; every RETRY re-checks, so a plan change during
    // the backoff window (or any lookup failure) stops the delivery instead of letting a retry slip past the gate.
    if (attempt > 1 && !(await webhooksEntitled(endpoint.organizationId))) {
      console.warn(JSON.stringify({ msg: "webhook_retry_skipped_plan", organizationId: endpoint.organizationId, eventType, attempt }));
      return;
    }
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
    // Validated again for EVERY attempt, and the connection is pinned to the validated address with redirects never
    // followed (lib/webhooks/safe-post.ts): DNS answers can change between creation and delivery, and a receiver can
    // answer with a redirect to an internal address.
    const signature = signPayload(endpoint.secret, rawBody);
    const response = await postWebhook(
      endpoint.url,
      { "Content-Type": "application/json", "X-Aegis-Signature": signature, "X-Aegis-Event": eventType },
      rawBody,
      DELIVERY_TIMEOUT_MS
    );
    const ok = response.status >= 200 && response.status < 300;

    await logDelivery(ok ? "SUCCESS" : "FAILED", response.status);

    if (ok) return "stop";
    if (response.status < 500) return "stop"; // 4xx is the receiver's problem, not worth retrying
    return "retry";
  } catch {
    await logDelivery("FAILED");
    return "retry";
  }
}
