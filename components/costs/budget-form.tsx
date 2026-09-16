"use client";

import { useActionState } from "react";
import { Label, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { createBudgetAction, type BudgetFormState } from "@/lib/costs/actions";
import { BUDGET_PERIODS } from "@/lib/validation/budget";

const initialState: BudgetFormState = {};

export function BudgetForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createBudgetAction, initialState);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-5 sm:items-end" noValidate>
      <div className="sm:col-span-2">
        <Label htmlFor="agentId">Scope</Label>
        <Select id="agentId" name="agentId" defaultValue="">
          <option value="">Whole organization</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="period">Period</Label>
        <Select id="period" name="period" defaultValue="MONTHLY">
          {BUDGET_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="limitDollars">Limit ($)</Label>
        <Input id="limitDollars" name="limitDollars" type="number" min="1" step="0.01" required placeholder="500" />
      </div>
      <div>
        <Label htmlFor="warningThresholdPercent">Warn at (%)</Label>
        <Input
          id="warningThresholdPercent"
          name="warningThresholdPercent"
          type="number"
          min="1"
          max="100"
          defaultValue="80"
        />
      </div>
      <Button type="submit" disabled={pending} className="sm:col-span-5 sm:w-fit">
        {pending ? "Saving…" : "Add budget"}
      </Button>
      {state.error && (
        <div className="sm:col-span-5">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
    </form>
  );
}
