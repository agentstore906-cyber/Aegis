"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { changeSubscriptionPlanAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingChangePlanButton({ planId, label }: { planId: string; label: string }) {
  const boundAction = changeSubscriptionPlanAction.bind(null, planId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={pending}>
        {pending ? "Updating…" : label}
      </Button>
    </form>
  );
}
