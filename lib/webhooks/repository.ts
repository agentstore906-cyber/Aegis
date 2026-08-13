import "server-only";

import { prisma } from "@/lib/db";
import { generateWebhookSecret } from "@/lib/webhooks/crypto";
import { assertSafeWebhookUrl } from "@/lib/webhooks/ssrf";

/**
 * Structurally excludes `secret` (an explicit `select`, not just "the UI
 * doesn't happen to render it") — the dashboard list view can never leak
 * it even by accident, since the returned type has no such field.
 */
export async function listWebhookEndpoints(organizationId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { organizationId },
    select: {
      id: true,
      organizationId: true,
      url: true,
      status: true,
      subscribedEvents: true,
      createdById: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getWebhookEndpoint(organizationId: string, id: string) {
  return prisma.webhookEndpoint.findFirst({ where: { id, organizationId } });
}

export type CreateWebhookEndpointInput = { url: string; subscribedEvents: string[] };

/** Validates the URL (lib/webhooks/ssrf.ts) before ever persisting it. Returns the raw secret once — never stored. */
export async function createWebhookEndpoint(
  organizationId: string,
  createdById: string | null,
  input: CreateWebhookEndpointInput
) {
  await assertSafeWebhookUrl(input.url);

  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: { organizationId, url: input.url, secret, subscribedEvents: input.subscribedEvents, createdById },
  });

  return { endpoint, secret };
}

export async function setWebhookEndpointStatus(organizationId: string, id: string, status: "ACTIVE" | "DISABLED") {
  const result = await prisma.webhookEndpoint.updateMany({ where: { id, organizationId }, data: { status } });
  return result.count > 0;
}

export async function deleteWebhookEndpoint(organizationId: string, id: string) {
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

export async function listDeliveriesForEndpoint(organizationId: string, webhookEndpointId: string, limit = 20) {
  return prisma.webhookDelivery.findMany({
    where: { organizationId, webhookEndpointId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
