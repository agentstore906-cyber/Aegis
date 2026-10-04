"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Label, Input, Select, Textarea, FieldHint } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/dashboard/status-badges";
import { SimulationResultView } from "@/components/policies/simulation-result";
import { runPolicyTesterAction, type PolicyTesterState } from "@/lib/policies/actions";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";

const initialState: PolicyTesterState = {};

const DATA_CLASSES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "FINANCIAL", "HEALTH", "CREDENTIALS"] as const;

export function PolicyTesterForm({ agents, canRecord }: { agents: { id: string; name: string }[]; canRecord: boolean }) {
  const [state, formAction, pending] = useActionState(runPolicyTesterAction, initialState);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-5" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Mode</legend>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="radio" name="mode" value="simulate" defaultChecked className="mt-1" />
            <span>
              <strong>Simulate</strong> — see what Aegis would do. Nothing is recorded, no approval is opened, and the agent&rsquo;s trust and history are untouched.
            </span>
          </label>
          <label className={`flex items-start gap-2 text-sm ${canRecord ? "text-foreground" : "text-muted-foreground"}`}>
            <input type="radio" name="mode" value="record" disabled={!canRecord} className="mt-1" />
            <span>
              <strong>Record</strong> — run the real engine and keep the evaluation. It can open an approval request or raise an alert and counts toward the agent&rsquo;s trust and history.
              {!canRecord && " (Needs permission to manage policies.)"}
            </span>
          </label>
        </fieldset>

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

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="destination">Destination (host)</Label>
            <Input id="destination" name="destination" maxLength={253} placeholder="api.example.com" />
          </div>
          <div>
            <Label htmlFor="service">Service</Label>
            <Input id="service" name="service" maxLength={60} placeholder="crm-api" />
          </div>
          <div>
            <Label htmlFor="recordCount">Records touched</Label>
            <Input id="recordCount" name="recordCount" type="number" min={0} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="byteCount">Bytes touched</Label>
            <Input id="byteCount" name="byteCount" type="number" min={0} placeholder="Optional" />
          </div>
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground">Data classes</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {DATA_CLASSES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm text-foreground">
                <input type="checkbox" name="dataClasses" value={c} /> {c.toLowerCase()}
              </label>
            ))}
          </div>
          <FieldHint>
            Optional. Policies can match these. A field you leave blank is <em>unreported</em>, and restrictive policies on it will apply (fail closed).
          </FieldHint>
        </fieldset>

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
          {pending ? "Working…" : "Run"}
        </Button>
      </form>

      <div>
        {state.simulation ? (
          <SimulationResultView simulation={state.simulation} />
        ) : !state.result ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
            <FlaskConical className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">No evaluation yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fill out the form and click Run to see what Aegis would decide.
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

              {state.result.alertId && (
                <p className="text-sm text-muted-foreground">
                  Raised a security alert.{" "}
                  <Link href="/security" className="text-foreground hover:underline">
                    View alerts
                  </Link>
                </p>
              )}

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
