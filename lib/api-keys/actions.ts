"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageApiKeys } from "@/lib/api-keys/authorization";
import { createApiKeySchema } from "@/lib/validation/api-key";
import * as repo from "@/lib/api-keys/repository";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { canCreateApiKey } from "@/lib/billing/entitlements";
import { trackEvent } from "@/lib/analytics/track";

export type CreateApiKeyState = {
  error?: string;
  createdKey?: { id: string; raw: string; prefix: string; name: string; environment: string };
};

export async function createApiKeyAction(
  _prevState: CreateApiKeyState,
  formData: FormData
): Promise<CreateApiKeyState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageApiKeys(role)) {
    return { error: "You don't have permission to manage API keys." };
  }

  const activeKeyCount = await prisma.apiKey.count({ where: { organizationId: organization.id, revokedAt: null } });
  const entitlement = canCreateApiKey(organization.plan, activeKeyCount);
  if (!entitlement.allowed) return { error: entitlement.reason };

  const parsed = createApiKeySchema.safeParse({
    name: formData.get("name"),
    environment: formData.get("environment"),
    expiresInDays: formData.get("expiresInDays") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid API key details" };
  }

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + Number(parsed.data.expiresInDays) * 24 * 60 * 60 * 1000)
    : null;

  const { apiKey, raw } = await prisma.$transaction(async (tx) => {
    const { apiKey, raw } = await repo.createApiKey(
      organization.id,
      user.id,
      { name: parsed.data.name, environment: parsed.data.environment, expiresAt },
      tx
    );
    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      eventType: AUDIT_EVENT_TYPES.API_KEY_CREATED,
      entityType: "ApiKey",
      entityId: apiKey.id,
      action: "api_key.create",
      metadata: { name: apiKey.name, environment: apiKey.environment, prefix: apiKey.prefix },
    });
    return { apiKey, raw };
  });

  trackEvent("api_key_created", { organizationId: organization.id });
  revalidatePath("/developers/api-keys");

  return {
    createdKey: {
      id: apiKey.id,
      raw,
      prefix: apiKey.prefix,
      name: apiKey.name,
      environment: apiKey.environment,
    },
  };
}

export async function revokeApiKeyAction(id: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageApiKeys(role)) {
    throw new Error("You don't have permission to manage API keys.");
  }

  const apiKey = await repo.getApiKey(organization.id, id);

  await prisma.$transaction(async (tx) => {
    const revoked = await repo.revokeApiKey(organization.id, id, tx);
    if (revoked && apiKey) {
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        eventType: AUDIT_EVENT_TYPES.API_KEY_REVOKED,
        entityType: "ApiKey",
        entityId: apiKey.id,
        action: "api_key.revoke",
        metadata: { name: apiKey.name, prefix: apiKey.prefix },
      });
    }
  });

  revalidatePath("/developers/api-keys");
}
