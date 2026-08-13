"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { createPortalSessionAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingPortalButton() {
  const [state, formAction, pending] = useActionState(createPortalSessionAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Opening…" : "Manage subscription"}
      </Button>
    </form>
  );
}
