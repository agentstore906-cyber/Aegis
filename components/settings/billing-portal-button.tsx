"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { createPortalSessionAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingPortalButton({
  label = "Manage subscription",
  variant = "secondary",
  className,
}: {
  label?: string;
  variant?: "primary" | "secondary";
  className?: string;
} = {}) {
  const [state, formAction, pending] = useActionState(createPortalSessionAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant={variant} className={cn(className)} disabled={pending}>
        {pending ? "Opening…" : label}
      </Button>
    </form>
  );
}
