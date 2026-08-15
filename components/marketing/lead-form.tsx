"use client";

import { useActionState } from "react";

import { submitLeadAction, type SubmitLeadState } from "@/lib/leads/actions";
import { Label, Input, Textarea, Select, FieldHint } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const initialState: SubmitLeadState = {};

export function LeadForm({ source = "CONTACT" }: { source?: "CONTACT" | "DEMO_REQUEST" | "ENTERPRISE" }) {
  const [state, formAction, pending] = useActionState(submitLeadAction, initialState);

  if (state.success) {
    return (
      <Alert tone="success">
        Thanks — we&rsquo;ll follow up at the email you gave us within one business day. In the
        meantime, feel free to <a href="/demo" className="underline">explore the demo</a>.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <input type="hidden" name="source" value={source} />
      {/* Honeypot — visually and AT hidden, no autocomplete a password manager would fill. Left blank, bots that fill every field trip it. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" type="text" required maxLength={120} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" required maxLength={200} autoComplete="email" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="company">Company</Label>
          <Input id="company" name="company" type="text" required maxLength={160} autoComplete="organization" />
        </div>
        <div>
          <Label htmlFor="role">Role</Label>
          <Input id="role" name="role" type="text" required maxLength={120} placeholder="CTO, Head of AI, ..." />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agentCount">Number of AI agents</Label>
          <Select id="agentCount" name="agentCount" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="1-5">1–5</option>
            <option value="6-20">6–20</option>
            <option value="21-100">21–100</option>
            <option value="100+">100+</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="primaryChallenge">Biggest concern</Label>
          <Select id="primaryChallenge" name="primaryChallenge" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="Security">Security</option>
            <option value="Permissions">Permissions</option>
            <option value="Cost">Cost</option>
            <option value="Audit">Audit</option>
            <option value="Reliability">Reliability</option>
            <option value="Human approvals">Human approvals</option>
            <option value="Other">Other</option>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="aiStack">AI frameworks / providers</Label>
        <Input id="aiStack" name="aiStack" type="text" maxLength={200} placeholder="OpenAI, Anthropic, LangGraph, custom agents..." />
        <FieldHint>Whatever you&rsquo;re running today — doesn&rsquo;t need to be exhaustive.</FieldHint>
      </div>

      <div>
        <Label htmlFor="message">Anything else? (optional)</Label>
        <Textarea id="message" name="message" rows={3} maxLength={2000} />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Request a demo"}
      </Button>
    </form>
  );
}
