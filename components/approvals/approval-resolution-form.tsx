"use client";

import { useState, useTransition } from "react";
import { Textarea, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { approveApprovalAction, rejectApprovalAction } from "@/lib/approvals/actions";

/**
 * Approve/Reject share one optional comment field, so this calls the two
 * Server Actions directly (like agent-status-toggle.tsx) instead of two
 * separate <form>s each needing their own useActionState — that would mean
 * two disconnected comment inputs for what is, to the reviewer, one
 * decision.
 */
export function ApprovalResolutionForm({ requestId }: { requestId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingDecision, setPendingDecision] = useState<"APPROVED" | "REJECTED" | null>(null);

  function submit(decision: "APPROVED" | "REJECTED") {
    setError(null);
    setPendingDecision(decision);
    const formData = new FormData();
    formData.set("comment", comment);
    const action = decision === "APPROVED" ? approveApprovalAction : rejectApprovalAction;

    startTransition(async () => {
      const result = await action(requestId, {}, formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <div>
        <Label htmlFor="comment">Comment (optional)</Label>
        <Textarea
          id="comment"
          rows={3}
          maxLength={500}
          placeholder="Add context for this decision…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={() => submit("REJECTED")}
        >
          {isPending && pendingDecision === "REJECTED" ? "Rejecting…" : "Reject"}
        </Button>
        <Button type="button" disabled={isPending} onClick={() => submit("APPROVED")}>
          {isPending && pendingDecision === "APPROVED" ? "Approving…" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
