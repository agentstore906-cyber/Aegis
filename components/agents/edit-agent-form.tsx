"use client";

import { useActionState } from "react";
import { updateAgentAction, type UpdateAgentState } from "@/lib/agents/actions";
import { Label, Input, Textarea, Select, FieldHint } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";
import type { Agent } from "@prisma/client";

const initialState: UpdateAgentState = {};

const MODEL_PROVIDERS = ["Anthropic", "OpenAI", "Google", "Mistral", "Custom"];

export function EditAgentForm({
  agent,
  teams = [],
}: {
  agent: Agent;
  teams?: { id: string; name: string }[];
}) {
  const updateWithSlug = updateAgentAction.bind(null, agent.slug);
  const [state, formAction, pending] = useActionState(updateWithSlug, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={agent.name}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={agent.description ?? ""}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="owner">Owner / team</Label>
          <Input id="owner" name="owner" required maxLength={80} defaultValue={agent.owner} />
        </div>

        {teams.length > 0 && (
          <div>
            <Label htmlFor="teamId">Team</Label>
            <Select id="teamId" name="teamId" defaultValue={agent.teamId ?? ""}>
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <FieldHint>Optional — used for cost breakdowns by team.</FieldHint>
          </div>
        )}

        <div>
          <Label htmlFor="environment">Environment</Label>
          <Select id="environment" name="environment" required defaultValue={agent.environment}>
            {AGENT_ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env.charAt(0) + env.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="modelProvider">Model provider</Label>
          <Select
            id="modelProvider"
            name="modelProvider"
            required
            defaultValue={agent.modelProvider}
          >
            {MODEL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="modelName">Model</Label>
          <Input
            id="modelName"
            name="modelName"
            required
            maxLength={60}
            defaultValue={agent.modelName}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="riskLevel">Risk level</Label>
        <Select id="riskLevel" name="riskLevel" required defaultValue={agent.riskLevel}>
          {AGENT_RISK_LEVELS.map((risk) => (
            <option key={risk} value={risk}>
              {risk.charAt(0) + risk.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <FieldHint>
          How much damage could this agent cause if it misbehaved or was compromised?
        </FieldHint>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <ButtonLink href={`/agents/${agent.slug}`} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
