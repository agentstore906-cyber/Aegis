"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldHint, Label, Select } from "@/components/ui/field";
import { disableRiskControlAction, updateRiskControlAction, type RiskControlActionState } from "@/lib/risk/actions";

const initial: RiskControlActionState = {};

type Props = {
  mode: "OBSERVE" | "APPROVAL_REQUIRED" | "ENFORCE";
  mediumAction: string;
  highAction: string;
  globallyDisabled: boolean;
};

export function RiskControlSettingsForm({ mode, mediumAction, highAction, globallyDisabled }: Props) {
  const [state, formAction, pending] = useActionState(updateRiskControlAction, initial);
  const [offState, offAction, offPending] = useActionState(disableRiskControlAction, initial);

  return (
    <div className="space-y-4">
      {globallyDisabled && (
        <Alert tone="warning">
          Risk enforcement is switched off for the whole platform (AEGIS_RISK_CONTROL_DISABLED). Every organization is
          treated as OBSERVE until it is removed.
        </Alert>
      )}
      <form action={formAction} className="space-y-4" noValidate>
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {state.success && <Alert tone="success">{state.success}</Alert>}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="mode">Mode</Label>
            <Select id="mode" name="mode" defaultValue={mode}>
              <option value="OBSERVE">Observe: record only</option>
              <option value="APPROVAL_REQUIRED">Approval required: never blocks</option>
              <option value="ENFORCE">Enforce: may block</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="mediumAction">Medium risk</Label>
            <Select id="mediumAction" name="mediumAction" defaultValue={mediumAction}>
              <option value="ALLOW">Allow</option>
              <option value="ALERT">Allow with alert</option>
              <option value="REQUIRE_APPROVAL">Require approval</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="highAction">High / critical risk</Label>
            <Select id="highAction" name="highAction" defaultValue={highAction}>
              <option value="REQUIRE_APPROVAL">Require approval</option>
              <option value="BLOCK">Block</option>
            </Select>
          </div>
        </div>
        <FieldHint>
          In Observe mode nothing changes, but this mapping still drives the &ldquo;would have&rdquo; figures below, so
          set it first to preview. Risk can only make a decision stricter than your policies; it never overrides a policy
          block or the kill switch.
        </FieldHint>

        {mode === "OBSERVE" && (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" name="confirm" className="mt-0.5" />
            <span>
              I understand that switching to Approval required or Enforce changes which agent actions are allowed.
            </span>
          </label>
        )}

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      {mode !== "OBSERVE" && (
        <form action={offAction} className="space-y-2 border-t border-border pt-4">
          {offState.error && <Alert tone="danger">{offState.error}</Alert>}
          {offState.success && <Alert tone="success">{offState.success}</Alert>}
          <p className="text-sm text-muted-foreground">
            Emergency stop: return to Observe immediately. Nothing is deleted; every past decision and assessment stays
            as recorded.
          </p>
          <Button type="submit" size="sm" variant="destructive" disabled={offPending}>
            {offPending ? "Switching…" : "Disable risk enforcement"}
          </Button>
        </form>
      )}
    </div>
  );
}
