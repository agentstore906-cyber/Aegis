/**
 * Integration test against the real dev database for the last-owner and
 * privilege-escalation invariants in lib/organizations/members.ts — the
 * safety-critical logic guaranteeing an organization can never end up
 * with zero Owners and that only an Owner can grant/revoke the Owner
 * role. Not previously covered by any test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changeMemberRole, removeMember } from "@/lib/organizations/members";
import { LastOwnerError, MemberNotFoundError, PrivilegeEscalationError } from "@/lib/organizations/errors";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let sameOrgOwnerMember: { id: string };
let engineerMember: { id: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Members Org", slug: `${RUN_ID}-members` } });

  const owner = await prisma.user.create({ data: { email: `${RUN_ID}-owner@example.com`, name: "Owner" } });
  const engineer = await prisma.user.create({ data: { email: `${RUN_ID}-engineer@example.com`, name: "Engineer" } });

  sameOrgOwnerMember = await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: "OWNER" },
  });
  engineerMember = await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: engineer.id, role: "ENGINEER" },
  });
});

afterAll(async () => {
  await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("last-owner protection", () => {
  it("refuses to demote the sole Owner", async () => {
    await expect(changeMemberRole(org.id, sameOrgOwnerMember.id, "ADMIN", "OWNER")).rejects.toThrow(LastOwnerError);

    const stillOwner = await prisma.organizationMember.findUniqueOrThrow({ where: { id: sameOrgOwnerMember.id } });
    expect(stillOwner.role).toBe("OWNER");
  });

  it("refuses to remove the sole Owner", async () => {
    await expect(removeMember(org.id, sameOrgOwnerMember.id, "OWNER")).rejects.toThrow(LastOwnerError);

    const stillExists = await prisma.organizationMember.findUnique({ where: { id: sameOrgOwnerMember.id } });
    expect(stillExists).not.toBeNull();
  });

  it("allows demoting an Owner once a second Owner exists", async () => {
    const secondOwnerUser = await prisma.user.create({
      data: { email: `${RUN_ID}-owner2@example.com`, name: "Second Owner" },
    });
    const secondOwner = await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: secondOwnerUser.id, role: "OWNER" },
    });

    await expect(changeMemberRole(org.id, sameOrgOwnerMember.id, "ADMIN", "OWNER")).resolves.toBeUndefined();

    const demoted = await prisma.organizationMember.findUniqueOrThrow({ where: { id: sameOrgOwnerMember.id } });
    expect(demoted.role).toBe("ADMIN");

    // Restore fixture state for subsequent tests in this file.
    await changeMemberRole(org.id, sameOrgOwnerMember.id, "OWNER", "OWNER");
    await prisma.organizationMember.delete({ where: { id: secondOwner.id } });
  });
});

describe("privilege escalation guard", () => {
  it("refuses to let a non-Owner grant the Owner role", async () => {
    await expect(changeMemberRole(org.id, engineerMember.id, "OWNER", "ADMIN")).rejects.toThrow(
      PrivilegeEscalationError
    );

    const stillEngineer = await prisma.organizationMember.findUniqueOrThrow({ where: { id: engineerMember.id } });
    expect(stillEngineer.role).toBe("ENGINEER");
  });

  it("allows an Owner to grant the Owner role", async () => {
    await expect(changeMemberRole(org.id, engineerMember.id, "OWNER", "OWNER")).resolves.toBeUndefined();
    const nowOwner = await prisma.organizationMember.findUniqueOrThrow({ where: { id: engineerMember.id } });
    expect(nowOwner.role).toBe("OWNER");

    // Restore: two Owners now exist, so demoting back is safe.
    await changeMemberRole(org.id, engineerMember.id, "ENGINEER", "OWNER");
  });

  it("refuses to let a non-Owner demote an existing Owner", async () => {
    // sameOrgOwnerMember is still OWNER at this point in the file.
    await expect(changeMemberRole(org.id, sameOrgOwnerMember.id, "ADMIN", "ADMIN")).rejects.toThrow(
      PrivilegeEscalationError
    );
  });
});

describe("ordinary mutations", () => {
  it("changing a non-Owner's role to a non-Owner role needs no special privilege", async () => {
    await expect(changeMemberRole(org.id, engineerMember.id, "SECURITY", "ENGINEER")).resolves.toBeUndefined();
    const updated = await prisma.organizationMember.findUniqueOrThrow({ where: { id: engineerMember.id } });
    expect(updated.role).toBe("SECURITY");
  });

  it("removing a non-Owner member succeeds", async () => {
    await expect(removeMember(org.id, engineerMember.id, "ADMIN")).resolves.toBeUndefined();
    const gone = await prisma.organizationMember.findUnique({ where: { id: engineerMember.id } });
    expect(gone).toBeNull();
  });

  it("throws MemberNotFoundError for a member that doesn't exist", async () => {
    await expect(changeMemberRole(org.id, "not-a-real-id", "ADMIN", "OWNER")).rejects.toThrow(MemberNotFoundError);
    await expect(removeMember(org.id, "not-a-real-id", "OWNER")).rejects.toThrow(MemberNotFoundError);
  });
});
