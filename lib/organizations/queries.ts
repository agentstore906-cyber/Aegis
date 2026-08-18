import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma, type PrismaOrTx } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { slugify } from "@/lib/utils";

export const ACTIVE_ORG_COOKIE = "aegis_org";

/**
 * Shared by createOrganizationAction and signUpAction so slug generation
 * can't drift between the two entry points. Accepts a transaction client so
 * callers that need the slug lookup and the org insert to be atomic (e.g.
 * signup, where the org must never exist without its owner membership) can
 * run it inside their own `$transaction`.
 */
export async function uniqueSlugFor(name: string, client: PrismaOrTx = prisma): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;

  while (await client.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function getUserMemberships(userId: string) {
  return prisma.organizationMember.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolves the caller's active organization from the session-scoped cookie,
 * falling back to their first membership. Every lookup is scoped to the
 * authenticated user's own memberships — a slug alone never grants access.
 */
export async function getActiveMembership(userId: string) {
  const memberships = await getUserMemberships(userId);
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const preferredSlug = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const preferred = preferredSlug
    ? memberships.find((m) => m.organization.slug === preferredSlug)
    : undefined;

  return preferred ?? memberships[0];
}

/**
 * Server-only guard for every org-scoped dashboard route. Ensures the
 * caller is signed in AND is a member of the organization being resolved.
 * Redirects to onboarding if they belong to no organization yet.
 */
export async function requireActiveOrganization() {
  const user = await requireUser();
  const membership = await getActiveMembership(user.id);

  if (!membership) {
    redirect("/onboarding");
  }

  return { user, organization: membership.organization, role: membership.role };
}

/** All members of an organization, for actor pickers (e.g. the audit trail filter). */
export async function listOrganizationMembers(organizationId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => m.user);
}

/**
 * Verifies the caller belongs to the organization that owns `organizationId`
 * before any tenant-scoped write or read. Never trust an organizationId
 * supplied by the client without this check.
 */
export async function requireOrgMembership(userId: string, organizationId: string) {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true },
  });

  if (!membership) {
    redirect("/onboarding");
  }

  return membership;
}
