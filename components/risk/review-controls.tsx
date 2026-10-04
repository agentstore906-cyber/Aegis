"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { labelRiskDecisionAction, type RiskControlActionState } from "@/lib/risk/actions";

const initial: RiskControlActionState = {};

const OPTIONS = [
  ["JUSTIFIED", "Justified"],
  ["FALSE_POSITIVE", "False positive"],
  ["UNSURE", "Unsure"],
] as const;

export function ReviewControls({ evaluationId, current }: { evaluationId: string; current: string | null }) {
  const [state, action, pending] = useActionState(labelRiskDecisionAction.bind(null, evaluationId), initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map(([value, text]) => (
        <Button
          key={value}
          type="submit"
          name="label"
          value={value}
          size="sm"
          variant={current === value ? "primary" : "secondary"}
          disabled={pending}
        >
          {text}
        </Button>
      ))}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
