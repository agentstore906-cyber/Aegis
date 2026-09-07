"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { usePaddleCheckout } from "@/components/settings/paddle-checkout-provider";

export function BillingUpgradeButton({ planId, label }: { planId: string; label: string }) {
  const { openCheckoutForPlan } = usePaddleCheckout();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await openCheckoutForPlan(planId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <Button type="button" size="sm" variant="secondary" className="w-full" disabled={pending} onClick={handleClick}>
        {pending ? "Opening checkout…" : label}
      </Button>
    </div>
  );
}
