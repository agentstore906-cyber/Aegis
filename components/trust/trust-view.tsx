import Link from "next/link";
import type { AgentTrustTransition, TrustState } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import { TRUST_CATEGORIES, TRUST_RECOVERY_MARGIN, TRUST_STATE_ORDER, TRUST_THRESHOLDS } from "@/lib/trust/config";
import { STATE_LABEL } from "@/lib/trust/score";
import type { TrustView } from "@/lib/trust/queries";
import type { TrustFactor, TrustLimit } from "@/lib/trust/types";

/**
 * Agent trust views (P3). Pure rendering of an evaluation the server already
 * made — no client state. Two questions only: "What is this agent's current
 * trust state?" and "Why?". Informational: trust blocks nothing in P3.
 */

const TONE: Record<TrustState, "success" | "info" | "warning" | "danger"> = {
  TRUSTED: "success",
  NORMAL: "info",
  DEGRADED: "warning",
  HIGH_RISK: "danger",
  RESTRICTED: "danger",
};

export function TrustBadge({ state }: { state: TrustState }) {
  return (
    <Badge tone={TONE[state]} dot>
      {STATE_LABEL[state]}
    </Badge>
  );
}

/** Compact card for the agent overview. */
export function TrustSummary({ slug, trust }: { slug: string; trust: TrustView }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <TrustBadge state={trust.state} />
        <span className="tabular-nums text-muted-foreground">{trust.score}/100</span>
      </div>
      <p className="text-xs text-muted-foreground">{trust.headline}</p>
      <p className="text-xs text-muted-foreground">
        <Link href={`/agents/${slug}?tab=trust`} className="font-medium text-foreground underline">
          Why this state
        </Link>
      </p>
    </div>
  );
}

function FactorRow({ factor }: { factor: TrustFactor }) {
  return (
    <li className="flex items-start justify-between gap-4 py-2 text-sm">
      <div className="min-w-0">
        <p className="text-foreground">{factor.summary}</p>
        <p className="text-xs text-muted-foreground">
          {TRUST_CATEGORIES[factor.category].label} · latest {formatRelativeTime(new Date(factor.at))}
        </p>
      </div>
      <span className="shrink-0 font-medium tabular-nums text-danger">−{factor.points}</span>
    </li>
  );
}

function LimitRow({ limit }: { limit: TrustLimit }) {
  return (
    <li className="py-2 text-sm text-foreground">
      <Badge tone="neutral" className="mr-2">
        {limit.code === "OPERATOR_CONTROL" ? "Operator control" : "Limited history"}
      </Badge>
      {limit.summary}
    </li>
  );
}

const DIRECTION_LABEL = { initialized: "Initialized", degraded: "Degraded", recovered: "Recovered", shifted: "Shifted" } as const;

function directionOf(t: AgentTrustTransition): keyof typeof DIRECTION_LABEL {
  if (t.previousScore === null || t.previousState === null) return "initialized";
  const worse = TRUST_STATE_ORDER.indexOf(t.newState) - TRUST_STATE_ORDER.indexOf(t.previousState);
  if (t.newScore < t.previousScore || worse > 0) return "degraded";
  if (t.newScore > t.previousScore || worse < 0) return "recovered";
  return "shifted";
}

const TRIGGER_LABEL: Record<AgentTrustTransition["trigger"], string> = {
  ACTIVITY_EVENT: "Activity event",
  POLICY_EVALUATION: "Policy decision",
  APPROVAL_DECISION: "Approval decision",
  SECURITY_ALERT: "Security alert",
  OPERATOR_CONTROL: "Operator control",
  SCHEDULED: "Scheduled re-evaluation",
  ON_DEMAND: "Viewed",
};

/** Full Trust tab. */
export function TrustDetails({
  trust,
  transitions,
}: {
  trust: TrustView;
  transitions: AgentTrustTransition[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current trust</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <TrustBadge state={trust.state} />
            <span className="text-2xl font-semibold tabular-nums text-foreground">{trust.score}</span>
            <span className="text-sm text-muted-foreground">
              in this state since {formatDateTime(trust.stateSince)} · evaluated {formatRelativeTime(trust.evaluatedAt)}
            </span>
          </div>
          <p className="text-sm text-foreground">{trust.headline}</p>
          <p className="text-xs text-muted-foreground">
            Trust is evidence, not a rating: every point below comes from something this agent did or from an operator
            action, and it fades as that evidence ages. Trust is informational for now — it does not block or change any
            action.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why</CardTitle>
        </CardHeader>
        <CardContent>
          {trust.limits.length === 0 && trust.factors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No negative evidence in the evidence windows, and nothing limiting the state.</p>
          ) : (
            <>
              {trust.limits.length > 0 && <ul className="divide-y divide-border">{trust.limits.map((l) => <LimitRow key={l.code} limit={l} />)}</ul>}
              {trust.factors.length > 0 && (
                <ul className="divide-y divide-border">
                  {trust.factors.map((f) => (
                    <FactorRow key={f.key} factor={f} />
                  ))}
                </ul>
              )}
              {trust.omittedFactors > 0 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {trust.omittedFactors} smaller factor{trust.omittedFactors === 1 ? "" : "s"} not listed (included in the totals).
                </p>
              )}
              {trust.categories.some((c) => c.capped) && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {trust.categories
                    .filter((c) => c.capped)
                    .map((c) => `${c.label} are capped at −${c.cap}`)
                    .join("; ")}
                  .
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {transitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trust changes recorded yet.</p>
          ) : (
            <ol className="divide-y divide-border">
              {transitions.map((t) => (
                <li key={t.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={directionOf(t) === "degraded" ? "warning" : directionOf(t) === "recovered" ? "success" : "neutral"}>
                      {DIRECTION_LABEL[directionOf(t)]}
                    </Badge>
                    <span className="font-medium tabular-nums text-foreground">
                      {t.previousScore !== null ? `${t.previousScore} → ` : ""}
                      {t.newScore}
                    </span>
                    {t.previousState !== t.newState && (
                      <span className="text-muted-foreground">
                        {t.previousState ? `${STATE_LABEL[t.previousState]} → ` : ""}
                        {STATE_LABEL[t.newState]}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(t.occurredAt)} · {TRIGGER_LABEL[t.trigger]}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{t.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How states are decided</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {TRUST_STATE_ORDER.map((state) => (
              <div key={state} className="flex items-center justify-between gap-3">
                <dt>
                  <TrustBadge state={state} />
                </dt>
                <dd className="tabular-nums text-muted-foreground">
                  {state === "RESTRICTED" ? "below 20, or paused/stopped by an operator" : `score ${TRUST_THRESHOLDS[state].min}+`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Score = 100 minus the evidence above. Moving up a state needs {TRUST_RECOVERY_MARGIN} extra points, so a score on
            a boundary doesn&rsquo;t flip back and forth. Behavioral changes, blocked actions, and policy violations fade over 7
            days, rejected approvals over 14, and security alerts over 30.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
