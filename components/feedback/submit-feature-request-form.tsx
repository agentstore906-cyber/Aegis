"use client";

import { useActionState } from "react";
import { Label, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { submitFeatureRequestAction, type SubmitFeatureRequestState } from "@/lib/feedback/actions";

const initialState: SubmitFeatureRequestState = {};

export function SubmitFeatureRequestForm() {
  const [state, formAction, pending] = useActionState(submitFeatureRequestAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div>
        <Label htmlFor="title">What should we build?</Label>
        <Input id="title" name="title" required maxLength={160} placeholder="e.g. Scoped API key picker" />
      </div>
      <div>
        <Label htmlFor="description">Details (optional)</Label>
        <Textarea id="description" name="description" rows={3} maxLength={4000} placeholder="What problem would this solve for your team?" />
      </div>
      <div>
        <Label htmlFor="category">Category (optional)</Label>
        <Input id="category" name="category" maxLength={80} placeholder="e.g. security, billing, developer experience" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}
