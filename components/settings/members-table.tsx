"use client";

import { useState, useTransition } from "react";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { changeMemberRoleAction, removeMemberAction } from "@/lib/organizations/actions";
import { MEMBER_ROLES } from "@/lib/validation/organization";
import { formatDateTime } from "@/lib/utils";
import type { MemberRole } from "@prisma/client";

type Member = {
  id: string;
  role: MemberRole;
  createdAt: Date;
  user: { id: string; name: string | null; email: string };
};

function MemberRow({ member, currentUserId }: { member: Member; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(newRole: string) {
    setError(null);
    const formData = new FormData();
    formData.set("role", newRole);
    startTransition(async () => {
      const result = await changeMemberRoleAction(member.id, {}, formData);
      if (result.error) setError(result.error);
    });
  }

  function handleRemove() {
    return removeMemberAction(member.id).then((result) => {
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <Tr className="hover:bg-surface-muted">
        <Td>
          <p className="font-medium text-foreground">
            {member.user.name ?? member.user.email}
            {member.user.id === currentUserId && <span className="ml-1.5 text-xs text-muted-foreground">(You)</span>}
          </p>
          <p className="text-xs text-muted-foreground">{member.user.email}</p>
        </Td>
        <Td>
          <Select
            defaultValue={member.role}
            disabled={isPending}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="w-36"
            aria-label={`Role for ${member.user.email}`}
          >
            {MEMBER_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.charAt(0) + role.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Td>
        <Td className="text-xs text-muted-foreground">{formatDateTime(member.createdAt)}</Td>
        <Td>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost" size="sm">
                Remove
              </Button>
            }
            title="Remove this member?"
            description={`${member.user.name ?? member.user.email} will lose access to this organization immediately.`}
            confirmLabel="Remove member"
            onConfirm={handleRemove}
          />
        </Td>
      </Tr>
      {error && (
        <Tr>
          <Td colSpan={4} className="py-0">
            <Alert tone="danger">{error}</Alert>
          </Td>
        </Tr>
      )}
    </>
  );
}

export function MembersTable({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Member</Th>
          <Th>Role</Th>
          <Th>Joined</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {members.map((member) => (
          <MemberRow key={member.id} member={member} currentUserId={currentUserId} />
        ))}
      </Tbody>
    </Table>
  );
}
