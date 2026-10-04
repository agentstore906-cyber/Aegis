import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Eye, ShieldQuestion, UserCheck } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { hasCapability } from "@/lib/rbac/capabilities";
import { getRiskControlSettings } from "@/lib/risk/settings";
import { getRiskAnalytics, listReviewQueue } from "@/lib/risk/analytics";
import { formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { DecisionBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { RiskControlSettingsForm } from "@/components/risk/risk-control-settings-form";
import { ReviewControls } from "@/components/risk/review-controls";

export const metadata: Metadata = { title: "Risk control" };

const MODE_LABEL = {
  OBSERVE: "Observe: risk is recorded, never enforced",
  APPROVAL_REQUIRED: "Approval required: risk can gate actions behind a human, never block",
  ENFORCE: "Enforce: risk can block, as configured",
} as const;

export default async function RiskControlPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!hasCapability(role, "view_security")) notFound();

  const canManage = hasCapability(role, "manage_risk_control");
  const canReview = hasCapability(role, "resolve_security");
  const [settings, analytics, queue] = await Promise.all([
    getRiskControlSettings(organization.id),
    getRiskAnalytics(organization.id),
    listReviewQueue(organization.id, { limit: 25 }),
  ]);
  if (!settings) notFound();

  const effectiveMode = settings.globallyDisabled ? "OBSERVE" : settings.mode;
  const { shadow, enforcement, review } = analytics;

  return (
    <div>
      <PageHeader
        title="Risk control"
        description={`${MODE_LABEL[effectiveMode]}. Showing the last ${analytics.windowDays} days.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Would have blocked" value={String(shadow.wouldHaveBlocked)} icon={Ban} tone={shadow.wouldHaveBlocked ? "danger" : undefined} />
        <StatCard label="Would have required approval" value={String(shadow.wouldHaveRequiredApproval)} icon={UserCheck} tone={shadow.wouldHaveRequiredApproval ? "warning" : undefined} />
        <StatCard label="Risk made stricter (enforced)" value={String(enforcement.escalated.total)} icon={ShieldQuestion} />
        <StatCard label="Assessed decisions" value={`${analytics.assessed} / ${analytics.evaluations}`} icon={Eye} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Mode and mapping</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <RiskControlSettingsForm
              mode={settings.mode}
              mediumAction={settings.mediumAction}
              highAction={settings.highAction}
              globallyDisabled={settings.globallyDisabled}
            />
          ) : (
            <p className="text-sm text-foreground">
              {MODE_LABEL[effectiveMode]}. Medium risk: {settings.mediumAction.replaceAll("_", " ").toLowerCase()}. High
              risk: {settings.highAction.replaceAll("_", " ").toLowerCase()}. Only owners, admins and security members can
              change this.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Shadow comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Risk would have blocked" value={shadow.wouldHaveBlocked} />
              <Row label="Risk would have required approval" value={shadow.wouldHaveRequiredApproval} />
              <Row label="Risk would have alerted" value={shadow.wouldHaveAlerted} />
              <Row label="Risk agrees with the actual decision" value={shadow.agrees} />
              <Row label="Actual decision already stricter" value={shadow.actualStricter} />
              <Row label="Held back: a human had approved" value={shadow.suppressedByApproval} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              &ldquo;Would have&rdquo; counts use your configured mapping and are what happened to requests that were
              <em> not</em> stopped by risk. They are counts of recorded decisions, not predictions of accuracy.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What risk control did</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Observed only (Observe mode)" value={enforcement.observed} />
              <Row label="Enforcing, no change to policy decision" value={enforcement.noChange} />
              <Row label="Made stricter: blocked" value={enforcement.escalated.blocked} />
              <Row label="Made stricter: approval required" value={enforcement.escalated.requiredApproval} />
              <Row label="Made stricter: allowed with alert" value={enforcement.escalated.alerted} />
              <Row label="Gate lifted by a human approval" value={enforcement.approvalHonored} />
              <Row label="Enforcement on, assessment unavailable (policy stood)" value={enforcement.unavailable} />
              <Row label="Decided by the kill switch" value={enforcement.killSwitch} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Top risk reasons</CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.topReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flagged decisions in this window.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {analytics.topReasons.map((r) => (
                <li key={r.code} className="flex justify-between gap-4">
                  <span className="text-foreground">
                    {r.code.replaceAll("_", " ")} <span className="text-xs text-muted-foreground">({r.family})</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.decisions} decisions · {r.agents} agent{r.agents === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>False-positive review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">
            {review.labeled} of {review.reviewable} flagged decisions reviewed ({review.justified} justified,{" "}
            {review.falsePositive} false positive, {review.unsure} unsure).{" "}
            {review.falsePositiveShareOfReviewed
              ? `${Math.round(review.falsePositiveShareOfReviewed.value * 100)}% of the ${review.falsePositiveShareOfReviewed.n} reviewed decisions were marked false positives.`
              : "Not enough reviewed decisions for a rate."}
          </p>
          <Alert tone="info">
            {review.note}
          </Alert>

          {queue.length > 0 && (
            <ul className="mt-4 divide-y divide-border">
              {queue.map((item) => (
                <li key={item.evaluationId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/policies/evaluations/${item.evaluationId}`} className="font-medium text-foreground hover:underline">
                        {item.action}
                      </Link>
                      {item.level && <RiskBadge level={item.level} />}
                      <DecisionBadge decision={item.decision} />
                      {item.recommended && item.recommended !== item.decision && (
                        <span className="text-xs text-muted-foreground">risk: {item.recommended.replaceAll("_", " ").toLowerCase()}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.agent.name} · {formatRelativeTime(item.createdAt)}
                      {item.headline ? ` · ${item.headline}` : ""}
                    </p>
                  </div>
                  {canReview && <ReviewControls evaluationId={item.evaluationId} current={item.label} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
