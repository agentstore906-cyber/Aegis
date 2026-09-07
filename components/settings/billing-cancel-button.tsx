"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cancelSubscriptionAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingCancelButton() {
  const [state, formAction, pending] = useActionState(cancelSubscriptionAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel subscription"}
      </Button>
    </form>
  );
}
