"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { acknowledgeSecurityAlertAction, resolveSecurityAlertAction } from "@/lib/security/actions";
import type { SecurityAlertStatus } from "@prisma/client";

export function SecurityAlertActions({ id, status }: { id: string; status: SecurityAlertStatus }) {
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"acknowledge" | "resolve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(kind: "acknowledge" | "resolve") {
    setError(null);
    setPendingAction(kind);
    const action = kind === "acknowledge" ? acknowledgeSecurityAlertAction : resolveSecurityAlertAction;
    startTransition(async () => {
      const result = await action(id);
      if (result.error) setError(result.error);
    });
  }

  if (status === "RESOLVED") return null;

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-2">
        {status === "OPEN" && (
          <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={() => run("acknowledge")}>
            <Eye className="size-3.5" aria-hidden="true" />
            {isPending && pendingAction === "acknowledge" ? "Acknowledging…" : "Acknowledge"}
          </Button>
        )}
        <Button type="button" size="sm" disabled={isPending} onClick={() => run("resolve")}>
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          {isPending && pendingAction === "resolve" ? "Resolving…" : "Resolve"}
        </Button>
      </div>
    </div>
  );
}
