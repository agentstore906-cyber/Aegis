"use client";

import { useActionState, useState } from "react";
import { Label, Input, Textarea, Select, FieldHint } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConditionEditor, type EditableCondition } from "@/components/policies/condition-editor";
import { describePolicy } from "@/lib/policies/describe";
import { POLICY_DECISIONS, POLICY_STATUSES } from "@/lib/validation/policy";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";
import type { Environment, Policy, PolicyCondition, PolicyDecision, RiskLevel } from "@prisma/client";
import type { PolicyFormState } from "@/lib/policies/actions";

const initialState: PolicyFormState = {};

type AgentOption = { id: string; name: string };

export function PolicyForm({
  policy,
  conditions,
  agents,
  action,
}: {
  policy?: Policy;
  conditions?: PolicyCondition[];
  agents: AgentOption[];
  action: (prevState: PolicyFormState, formData: FormData) => Promise<PolicyFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const [agentId, setAgentId] = useState(policy?.agentId ?? "");
  const [policyAction, setPolicyAction] = useState(policy?.action ?? "");
  const [resource, setResource] = useState(policy?.resource ?? "");
  const [environment, setEnvironment] = useState<Environment | "">(policy?.environment ?? "");
  const [tool, setTool] = useState(policy?.tool ?? "");
  const [riskLevel, setRiskLevel] = useState<RiskLevel | "">(policy?.riskLevel ?? "");
  const [decision, setDecision] = useState<PolicyDecision>(policy?.decision ?? "REQUIRE_APPROVAL");
  const [editableConditions, setEditableConditions] = useState<EditableCondition[]>(
    (conditions ?? []).map((c) => ({
      field: c.field,
      operator: c.operator,
      rawValue: Array.isArray(c.value) ? (c.value as string[]).join(", ") : String(c.value),
    }))
  );

  const agentName = agentId ? agents.find((a) => a.id === agentId)?.name ?? null : null;
  const preview = policyAction
    ? describePolicy({
        agentName,
        action: policyAction,
        resource: resource || null,
        environment: environment || null,
        tool: tool || null,
        riskLevel: riskLevel || null,
        decision,
        conditions: editableConditions
          .filter((c) => c.field)
          .map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.rawValue,
          })),
      })
    : null;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div className="space-y-5 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">General</p>

        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={100}
            placeholder="Refunds above $500"
            defaultValue={policy?.name}
          />
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={policy?.description ?? ""}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={policy?.status ?? "ACTIVE"}>
              {POLICY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              min={0}
              max={1000}
              defaultValue={policy?.priority ?? 100}
            />
            <FieldHint>Higher wins when explaining ties among same-severity policies.</FieldHint>
          </div>
          <div>
            <Label htmlFor="decision">Decision</Label>
            <Select
              id="decision"
              name="decision"
              value={decision}
              onChange={(e) => setDecision(e.target.value as PolicyDecision)}
            >
              {POLICY_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-5 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scope</p>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="agentId">Agent</Label>
            <Select id="agentId" name="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Any agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="action">Action</Label>
            <Input
              id="action"
              name="action"
              required
              maxLength={80}
              placeholder="refund.issue"
              value={policyAction}
              onChange={(e) => setPolicyAction(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="resource">Resource</Label>
            <Input
              id="resource"
              name="resource"
              maxLength={80}
              placeholder="Optional"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="environment">Environment</Label>
            <Select
              id="environment"
              name="environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as Environment | "")}
            >
              <option value="">Any environment</option>
              {AGENT_ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {env.charAt(0) + env.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tool">Tool</Label>
            <Input
              id="tool"
              name="tool"
              maxLength={60}
              placeholder="Optional"
              value={tool}
              onChange={(e) => setTool(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="riskLevel">Risk level</Label>
            <Select
              id="riskLevel"
              name="riskLevel"
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value as RiskLevel | "")}
            >
              <option value="">Any risk level</option>
              {AGENT_RISK_LEVELS.map((risk) => (
                <option key={risk} value={risk}>
                  {risk.charAt(0) + risk.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conditions</p>
        <ConditionEditor initial={editableConditions} onChange={setEditableConditions} />
      </div>

      {preview && (
        <div className="rounded-lg border border-brand/20 bg-brand/5 p-4 text-sm text-foreground">
          <span className="font-medium">Preview: </span>
          {preview}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : policy ? "Save changes" : "Create policy"}
        </Button>
        <ButtonLink href="/policies" variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
