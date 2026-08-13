"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { createCheckoutSessionAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingUpgradeButton({ planId, label }: { planId: string; label: string }) {
  const boundAction = createCheckoutSessionAction.bind(null, planId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={pending}>
        {pending ? "Redirecting…" : label}
      </Button>
    </form>
  );
}
