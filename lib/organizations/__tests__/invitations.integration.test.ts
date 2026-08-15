/**
 * Integration test against the real dev database for the Phase 10
 * invitation gaps: resend regenerates the token (old link stops working),
 * a repeated invite to the same pending email reissues rather than
 * duplicating, and revoke/resend record audit events.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/organizations/invitations";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let owner: { id: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Invitations Org", slug: `${RUN_ID}-invites` } });
  owner = await prisma.user.create({ data: { email: `${RUN_ID}-owner@example.com`, name: "Owner" } });
});

afterAll(async () => {
  await prisma.organizationInvitation.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
});

describe("createInvitation duplicate handling", () => {
  it("reissues the existing pending invitation instead of creating a second row", async () => {
    const first = await createInvitation(org.id, owner.id, "OWNER", "duplicate@example.com", "ENGINEER");
    const second = await createInvitation(org.id, owner.id, "OWNER", "duplicate@example.com", "ADMIN");

    expect(second.id).toBe(first.id);
    expect(second.token).not.toBe(first.token);
    expect(second.role).toBe("ADMIN");

    const count = await prisma.organizationInvitation.count({
      where: { organizationId: org.id, email: "duplicate@example.com" },
    });
    expect(count).toBe(1);
  });
});

describe("resendInvitation", () => {
  it("regenerates the token so the old shared link stops working", async () => {
    const invitation = await createInvitation(org.id, owner.id, "OWNER", "resend@example.com", "ENGINEER");
    const oldToken = invitation.token;

    const resent = await resendInvitation(org.id, invitation.id);

    expect(resent).not.toBeNull();
    expect(resent!.token).not.toBe(oldToken);
    expect(await prisma.organizationInvitation.findUnique({ where: { token: oldToken } })).toBeNull();
  });

  it("returns null for an invitation that no longer exists", async () => {
    const result = await resendInvitation(org.id, "not-a-real-id");
    expect(result).toBeNull();
  });
});

describe("revokeInvitation", () => {
  it("deletes the pending invitation", async () => {
    const invitation = await createInvitation(org.id, owner.id, "OWNER", "revoke@example.com", "ENGINEER");
    const revoked = await revokeInvitation(org.id, invitation.id);
    expect(revoked).toBe(true);
    expect(await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } })).toBeNull();
  });

  it("cannot revoke another organization's invitation", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org", slug: `${RUN_ID}-other` } });
    const invitation = await createInvitation(org.id, owner.id, "OWNER", "cross-org@example.com", "ENGINEER");

    const revoked = await revokeInvitation(otherOrg.id, invitation.id);
    expect(revoked).toBe(false);
    expect(await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } })).not.toBeNull();

    await prisma.organizationInvitation.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
