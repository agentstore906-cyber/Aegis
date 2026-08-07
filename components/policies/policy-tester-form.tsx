"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Label, Input, Select, Textarea, FieldHint } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/dashboard/status-badges";
import { runPolicyTesterAction, type PolicyTesterState } from "@/lib/policies/actions";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";

const initialState: PolicyTesterState = {};

export function PolicyTesterForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(runPolicyTesterAction, initialState);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-5" noValidate>
        <div>
          <Label htmlFor="agentId">Agent</Label>
          <Select id="agentId" name="agentId" required defaultValue="">
            <option value="" disabled>
              Select an agent
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="action">Action</Label>
          <Input id="action" name="action" required maxLength={80} placeholder="refund.issue" />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="resource">Resource</Label>
            <Input id="resource" name="resource" maxLength={80} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="environment">Environment</Label>
            <Select id="environment" name="environment" defaultValue="">
              <option value="">Not set</option>
              {AGENT_ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {env.charAt(0) + env.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tool">Tool</Label>
            <Input id="tool" name="tool" maxLength={60} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="riskLevel">Risk level</Label>
            <Select id="riskLevel" name="riskLevel" defaultValue="">
              <option value="">Not set</option>
              {AGENT_RISK_LEVELS.map((risk) => (
                <option key={risk} value={risk}>
                  {risk.charAt(0) + risk.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="contextJson">Context (JSON)</Label>
          <Textarea
            id="contextJson"
            name="contextJson"
            rows={4}
            className="font-mono text-xs"
            placeholder={'{\n  "amount": 1250,\n  "customer": "Acme Inc."\n}'}
          />
          <FieldHint>Optional. Plain JSON object — strings, numbers, and booleans only.</FieldHint>
        </div>

        {state.error && <Alert tone="danger">{state.error}</Alert>}

        <Button type="submit" disabled={pending} className="w-full">
          <FlaskConical className="size-4" aria-hidden="true" />
          {pending ? "Evaluating…" : "Evaluate"}
        </Button>
      </form>

      <div>
        {!state.result ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
            <FlaskConical className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">No evaluation yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fill out the form and click Evaluate to see what Aegis would decide.
            </p>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
              <DecisionBadge decision={state.result.decision} />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-foreground">{state.result.reason}</p>

              {state.result.matchedPermissionSnapshot && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Baseline permission
                  </p>
                  <p className="font-mono text-xs text-foreground">
                    {state.result.matchedPermissionSnapshot.action} →{" "}
                    {state.result.matchedPermissionSnapshot.decision}
                  </p>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Matched policies
                </p>
                {state.result.matchedPolicySnapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None</p>
                ) : (
                  <ul className="space-y-1">
                    {state.result.matchedPolicySnapshots.map((p) => (
                      <li key={p.id} className="text-sm text-foreground">
                        {p.name} <span className="text-muted-foreground">({p.decision})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                <p>Evaluation ID: {state.result.evaluationId}</p>
                <p>Trace ID: {state.result.traceId}</p>
                <Link
                  href={`/policies/evaluations/${state.result.evaluationId}`}
                  className="mt-1 inline-block text-foreground hover:underline"
                >
                  View full evaluation
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
