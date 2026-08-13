"use client";

import { useActionState, useTransition } from "react";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createTeamAction, deleteTeamAction, type TeamFormState } from "@/lib/teams/actions";

const initialState: TeamFormState = {};

type Team = { id: string; name: string; _count: { agents: number } };

export function TeamsPanel({ teams }: { teams: Team[] }) {
  const [state, formAction, pending] = useActionState(createTeamAction, initialState);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {teams.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{team.name}</p>
                <p className="text-xs text-muted-foreground">
                  {team._count.agents} agent{team._count.agents === 1 ? "" : "s"}
                </p>
              </div>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" size="sm">
                    Delete
                  </Button>
                }
                title="Delete this team?"
                description={`Agents assigned to "${team.name}" will be unassigned, not deleted.`}
                confirmLabel="Delete team"
                onConfirm={() => startTransition(() => deleteTeamAction(team.id))}
              />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="space-y-3">
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="teamName">New team</Label>
            <Input id="teamName" name="name" required minLength={2} maxLength={60} placeholder="Platform" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add team"}
          </Button>
        </div>
      </form>
    </div>
  );
}
