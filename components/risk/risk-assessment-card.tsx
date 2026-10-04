import type { RiskLevel } from "@prisma/client";

import { RiskBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiskControlRecord } from "@/lib/risk/record";
import type { RiskAssessment } from "@/lib/risk/types";

/** What this evaluation's risk control actually did, in words that never claim more than the record shows. */
function controlSentence(control: RiskControlRecord | null): string {
  if (!control) return "Shadow mode: this assessment is recorded for review and did not change the decision.";
  switch (control.outcome) {
    case "OBSERVED":
      return "Observe mode: this assessment is recorded for review and did not change the decision.";
    case "NO_CHANGE":
      return `Risk control (${control.effectiveMode}) was on and had nothing to add to the policy decision.`;
    case "ESCALATED":
      return `Risk control (${control.effectiveMode}) made this decision stricter: policies alone returned ${control.policyDecision.replaceAll("_", " ")}; Aegis returned ${control.finalDecision.replaceAll("_", " ")}.`;
    case "APPROVAL_HONORED":
      return "Risk control would have gated this request, but a human had approved this exact request, so it was allowed.";
    case "UNAVAILABLE":
      return "Risk control was on but no assessment could be produced; the policy decision stood.";
    case "KILL_SWITCH":
      return "The kill switch decided this request; risk control was not consulted.";
  }
}

/**
 * The P4 shadow risk explanation for one evaluation: headline, numbered
 * reasons (each one a statement about real evidence), and the actual-vs-risk
 * comparison. Informational — it never changed the decision.
 */
export function RiskAssessmentCard({ assessment, control = null }: { assessment: RiskAssessment | null; control?: RiskControlRecord | null }) {
  if (!assessment) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Risk assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No risk assessment was recorded for this evaluation (it predates the risk engine, or the assessment was unavailable).
          </p>
        </CardContent>
      </Card>
    );
  }

  const { shadow } = assessment;
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Risk assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={assessment.level as RiskLevel} />
          <span className="text-sm font-medium text-foreground">{assessment.headline}</span>
        </div>

        {assessment.reasons.length > 0 && (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            {assessment.reasons.map((reason) => (
              <li key={reason.rank}>
                {reason.summary}{" "}
                <span className="text-xs text-muted-foreground">
                  ({reason.severity.toLowerCase()} · {reason.family})
                </span>
              </li>
            ))}
          </ol>
        )}

        {assessment.escalation.applied && (
          <p className="mt-3 text-xs text-muted-foreground">
            Raised from {assessment.escalation.from} to {assessment.escalation.to}: independent evidence from{" "}
            {assessment.escalation.corroboratingFamilies.join(", ")} agrees.
          </p>
        )}

        {assessment.context.notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {assessment.context.notes.map((note) => (
              <li key={note.code}>Not known: {note.summary}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <Badge tone={shadow.outcome === "WOULD_ESCALATE" ? "warning" : "neutral"}>
            {{ WOULD_ESCALATE: "Would escalate", AGREES: "Agrees", ACTUAL_STRICTER: "Actual stricter", SUPPRESSED: "Human approved" }[shadow.outcome]}
          </Badge>
          <span className="text-foreground">{shadow.summary}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{controlSentence(control)}</p>
      </CardContent>
    </Card>
  );
}
