"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { requireActiveOrganization, ACTIVE_ORG_COOKIE, uniqueSlugFor } from "@/lib/organizations/queries";
import { canManageMembers } from "@/lib/organizations/authorization";
import * as membersRepo from "@/lib/organizations/members";
import * as invitationsRepo from "@/lib/organizations/invitations";
import {
  InvitationExpiredError,
  InvitationNotFoundError,
  LastOwnerError,
  MemberNotFoundError,
  PrivilegeEscalationError,
} from "@/lib/organizations/errors";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  changeMemberRoleSchema,
  retentionSettingsSchema,
  organizationGeneralSchema,
} from "@/lib/validation/organization";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";
import { canInviteMember } from "@/lib/billing/entitlements";

export type CreateOrganizationState = {
  error?: string;
};

export async function createOrganizationAction(
  _prevState: CreateOrganizationState,
  formData: FormData
): Promise<CreateOrganizationState> {
  const user = await requireUser();

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid organization name" };
  }

  const slug = await uniqueSlugFor(parsed.data.name);

  const organization = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organization.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  trackEvent("workspace_created", { organizationId: organization.id });

  redirect("/onboarding/connect");
}

// ---------------------------------------------------------------------------
// General settings
// ---------------------------------------------------------------------------

export type OrganizationSettingsState = { error?: string; success?: boolean };

export async function updateOrganizationGeneralAction(
  _prevState: OrganizationSettingsState,
  formData: FormData
): Promise<OrganizationSettingsState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) return { error: "You don't have permission to edit organization settings." };

  const parsed = organizationGeneralSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };

  await prisma.organization.update({ where: { id: organization.id }, data: { name: parsed.data.name } });
  await recordAuditEvent(prisma, {
    organizationId: organization.id,
    actorType: "USER",
    actorUserId: user.id,
    eventType: AUDIT_EVENT_TYPES.ORGANIZATION_SETTINGS_UPDATED,
    entityType: "Organization",
    entityId: organization.id,
    action: "organization.rename",
    metadata: { name: parsed.data.name },
  });

  revalidatePath("/settings/organization");
  return { success: true };
}

export async function updateRetentionSettingsAction(
  _prevState: OrganizationSettingsState,
  formData: FormData
): Promise<OrganizationSettingsState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) return { error: "You don't have permission to edit organization settings." };

  const parsed = retentionSettingsSchema.safeParse({
    activityRetentionDays: formData.get("activityRetentionDays") ?? "",
    auditRetentionDays: formData.get("auditRetentionDays") ?? "",
    securityRetentionDays: formData.get("securityRetentionDays") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid retention settings" };

  await prisma.organization.update({ where: { id: organization.id }, data: parsed.data });
  await recordAuditEvent(prisma, {
    organizationId: organization.id,
    actorType: "USER",
    actorUserId: user.id,
    eventType: AUDIT_EVENT_TYPES.ORGANIZATION_SETTINGS_UPDATED,
    entityType: "Organization",
    entityId: organization.id,
    action: "organization.retention_update",
    metadata: parsed.data,
  });

  revalidatePath("/settings/organization");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberActionState = { error?: string };

export async function changeMemberRoleAction(
  memberId: string,
  _prevState: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) return { error: "You don't have permission to manage members." };

  const parsed = changeMemberRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid role" };

  try {
    await prisma.$transaction(async (tx) => {
      await membersRepo.changeMemberRole(organization.id, memberId, parsed.data.role, role, tx);
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        eventType: AUDIT_EVENT_TYPES.MEMBER_ROLE_CHANGED,
        entityType: "OrganizationMember",
        entityId: memberId,
        action: "member.role_change",
        metadata: { newRole: parsed.data.role },
      });
    });
  } catch (error) {
    if (error instanceof LastOwnerError || error instanceof PrivilegeEscalationError || error instanceof MemberNotFoundError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/settings/organization");
  return {};
}

export async function removeMemberAction(memberId: string): Promise<MemberActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) return { error: "You don't have permission to manage members." };

  try {
    await prisma.$transaction(async (tx) => {
      await membersRepo.removeMember(organization.id, memberId, role, tx);
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        eventType: AUDIT_EVENT_TYPES.MEMBER_REMOVED,
        entityType: "OrganizationMember",
        entityId: memberId,
        action: "member.remove",
      });
    });
  } catch (error) {
    if (error instanceof LastOwnerError || error instanceof PrivilegeEscalationError || error instanceof MemberNotFoundError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/settings/organization");
  return {};
}

// ---------------------------------------------------------------------------
// Invitations — no email is sent; the admin shares the generated link
// directly. See docs/rbac.md.
// ---------------------------------------------------------------------------

export type InviteMemberState = { error?: string; inviteUrl?: string };

export async function inviteMemberAction(
  _prevState: InviteMemberState,
  formData: FormData
): Promise<InviteMemberState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) return { error: "You don't have permission to invite members." };

  const memberCount = await prisma.organizationMember.count({ where: { organizationId: organization.id } });
  const entitlement = canInviteMember(organization.plan, memberCount);
  if (!entitlement.allowed) return { error: entitlement.reason };

  const parsed = inviteMemberSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid invitation details" };

  const existingMember = await prisma.organizationMember.findFirst({
    where: { organizationId: organization.id, user: { email: parsed.data.email } },
  });
  if (existingMember) return { error: "This person is already a member of this organization." };

  let invitation;
  try {
    invitation = await invitationsRepo.createInvitation(organization.id, user.id, role, parsed.data.email, parsed.data.role);
  } catch (error) {
    if (error instanceof PrivilegeEscalationError) return { error: error.message };
    throw error;
  }

  await recordAuditEvent(prisma, {
    organizationId: organization.id,
    actorType: "USER",
    actorUserId: user.id,
    eventType: AUDIT_EVENT_TYPES.MEMBER_INVITED,
    entityType: "OrganizationInvitation",
    entityId: invitation.id,
    action: "member.invite",
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidatePath("/settings/organization");
  return { inviteUrl: `/invitations/${invitation.token}` };
}

export async function revokeInvitationAction(id: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) throw new Error("You don't have permission to manage invitations.");

  const revoked = await invitationsRepo.revokeInvitation(organization.id, id);
  if (revoked) {
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      eventType: AUDIT_EVENT_TYPES.MEMBER_INVITATION_REVOKED,
      entityType: "OrganizationInvitation",
      entityId: id,
      action: "member.invitation.revoke",
    });
  }
  revalidatePath("/settings/organization");
}

export async function resendInvitationAction(id: string): Promise<{ inviteUrl?: string }> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) throw new Error("You don't have permission to manage invitations.");

  const invitation = await invitationsRepo.resendInvitation(organization.id, id);
  if (invitation) {
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      eventType: AUDIT_EVENT_TYPES.MEMBER_INVITATION_RESENT,
      entityType: "OrganizationInvitation",
      entityId: invitation.id,
      action: "member.invitation.resend",
      metadata: { email: invitation.email },
    });
  }

  revalidatePath("/settings/organization");
  return invitation ? { inviteUrl: `/invitations/${invitation.token}` } : {};
}

export type AcceptInvitationState = { error?: string };

/**
 * Accepting an invitation deliberately does NOT go through
 * requireActiveOrganization() — the whole point is a user who may not
 * belong to any organization yet. Only requires a signed-in user; the
 * email-match check happens in the page before this is even callable
 * (see app/invitations/[token]/page.tsx), and acceptInvitation() itself
 * trusts the authenticated userId, never a client-supplied one.
 */
export async function acceptInvitationAction(token: string): Promise<AcceptInvitationState> {
  const user = await requireUser();

  let organization;
  try {
    organization = await invitationsRepo.acceptInvitation(token, user.id);
  } catch (error) {
    if (error instanceof InvitationNotFoundError || error instanceof InvitationExpiredError) {
      return { error: error.message };
    }
    throw error;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organization.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/overview");
}
