"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageWebhooks } from "@/lib/webhooks/authorization";
import { createWebhookEndpointSchema } from "@/lib/validation/webhook";
import * as repo from "@/lib/webhooks/repository";
import { UnsafeWebhookUrlError } from "@/lib/webhooks/ssrf";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { canCreateWebhook } from "@/lib/billing/entitlements";

export type CreateWebhookEndpointState = {
  error?: string;
  createdEndpoint?: { id: string; url: string; secret: string };
};

export async function createWebhookEndpointAction(
  _prevState: CreateWebhookEndpointState,
  formData: FormData
): Promise<CreateWebhookEndpointState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageWebhooks(role)) {
    return { error: "You don't have permission to manage webhooks." };
  }

  const entitlement = canCreateWebhook(organization.plan);
  if (!entitlement.allowed) return { error: entitlement.reason };

  const parsed = createWebhookEndpointSchema.safeParse({
    url: formData.get("url"),
    subscribedEvents: formData.getAll("subscribedEvents"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid webhook details" };
  }

  let created: Awaited<ReturnType<typeof repo.createWebhookEndpoint>>;
  try {
    created = await repo.createWebhookEndpoint(organization.id, user.id, parsed.data);
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) {
      return { error: error.message };
    }
    throw error;
  }

  await recordAuditEvent(prisma, {
    organizationId: organization.id,
    actorType: "USER",
    actorUserId: user.id,
    eventType: AUDIT_EVENT_TYPES.WEBHOOK_ENDPOINT_CREATED,
    entityType: "WebhookEndpoint",
    entityId: created.endpoint.id,
    action: "webhook_endpoint.create",
    metadata: { url: created.endpoint.url, subscribedEvents: created.endpoint.subscribedEvents },
  });

  revalidatePath("/integrations");

  return { createdEndpoint: { id: created.endpoint.id, url: created.endpoint.url, secret: created.secret } };
}

export async function setWebhookEndpointStatusAction(id: string, status: "ACTIVE" | "DISABLED") {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageWebhooks(role)) {
    throw new Error("You don't have permission to manage webhooks.");
  }

  await repo.setWebhookEndpointStatus(organization.id, id, status);
  revalidatePath("/integrations");
}

export async function deleteWebhookEndpointAction(id: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageWebhooks(role)) {
    throw new Error("You don't have permission to manage webhooks.");
  }

  const endpoint = await repo.getWebhookEndpoint(organization.id, id);
  const deleted = await repo.deleteWebhookEndpoint(organization.id, id);

  if (deleted && endpoint) {
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      eventType: AUDIT_EVENT_TYPES.WEBHOOK_ENDPOINT_DELETED,
      entityType: "WebhookEndpoint",
      entityId: endpoint.id,
      action: "webhook_endpoint.delete",
      metadata: { url: endpoint.url },
    });
  }

  revalidatePath("/integrations");
}
