import Link from "next/link";

import { AdoptionBadge, FlagBadges, PostureBadge, coverageText } from "@/components/control/control-badges";
import { DecisionBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentControlView } from "@/lib/control/agent-view";
import { isUnowned } from "@/lib/control/posture";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

const ASSURANCE_TEXT = {
  ISOLATED: "Has its own key, and no shared (organization-wide) key exists, so only this agent's key can speak for it.",
  BOUND_SHARED: "Has its own key, but organization-wide keys also exist: anyone holding one can still act as this agent.",
  ORG_WIDE_ONLY: "No key of its own: its identity is only as protected as the shared organization-wide keys. Create a key limited to this agent.",
  NO_KEY: "No active API key — it cannot call the API (for example a connector-managed agent).",
} as const;

const lower = (s: string) => s.replaceAll("_", " ").toLowerCase();

export function AgentControlPanel({ view, organizationName }: { view: AgentControlView; organizationName: string }) {
  const { agent } = view;
  const approvalPermissions = view.permissions.filter((p) => p.decision === "REQUIRE_APPROVAL");
  const approvalPolicies = view.policies.filter((p) => p.decision === "REQUIRE_APPROVAL");
  const decisions = agent.decisions7d;
  const decisionTotal = decisions.ALLOW + decisions.ALERT + decisions.REQUIRE_APPROVAL + decisions.BLOCK;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PostureBadge posture={agent.posture} />
        <AdoptionBadge stage={agent.adoption} />
        <FlagBadges flags={agent.attention} />
      </div>
      <p className="text-sm text-muted-foreground">
        Everything below is read from stored records for the last 7 days unless stated. Aegis returns decisions; whether an integration honors them is shown as enforcement coverage, never assumed.{" "}
        <Link href="/policies/test" className="text-foreground hover:underline">
          Ask what Aegis would do for an action →
        </Link>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Who is this agent?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Name">{agent.name}</Field>
            <Field label="Organization">{organizationName}</Field>
            <Field label="Owner">
              {agent.owner}
              {isUnowned(agent.owner) && <span className="text-warning"> — no owner assigned</span>}
              {agent.team && <span className="text-muted-foreground"> · team {agent.team}</span>}
            </Field>
            <Field label="Environment">{agent.environment.toLowerCase()} (set by Aegis, not by the agent)</Field>
            <Field label="Lifecycle">{lower(agent.status)}</Field>
            <Field label="Model">{agent.model}{agent.framework ? ` · ${agent.framework}` : ""}</Field>
            <Field label="Created">{formatDateTime(agent.createdAt)}</Field>
            <Field label="Last active">{agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "never"}</Field>
            <Field label="Connector">{agent.connection ? lower(agent.connection) : "none (reports through the API)"}</Field>
          </dl>
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Identity protection</p>
            <p className="mt-1 text-foreground">{ASSURANCE_TEXT[agent.identity.assurance]}</p>
            {view.keys.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {view.keys.map((k) => (
                  <li key={k.id}>
                    <span className="font-mono">{k.prefix}…</span> {k.name} · {k.lastUsedAt ? `used ${formatRelativeTime(k.lastUsedAt)}` : "never used"} · {k.expiresAt ? `expires ${formatDateTime(k.expiresAt)}` : "no expiry"}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {agent.identity.orgWideKeys} active organization-wide key{agent.identity.orgWideKeys === 1 ? "" : "s"} in this organization.{" "}
              <Link href="/developers/api-keys" className="hover:underline">
                Manage keys
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What can it do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {view.permissions.length === 0 ? (
            <p className="text-warning">Nothing is granted. Aegis default-denies every action this agent asks about.</p>
          ) : (
            <ul className="space-y-1">
              {view.permissions.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{p.action}</span>
                  {p.resource && <span className="text-xs text-muted-foreground">on {p.resource}</span>}
                  <DecisionBadge decision={p.decision} />
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Policies that apply</p>
            {view.policies.length === 0 ? (
              <p className="text-muted-foreground">None.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {view.policies.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/policies/${p.id}/edit`} className="hover:underline">
                      {p.name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">{p.action}</span>
                    <DecisionBadge decision={p.decision} />
                    <span className="text-xs text-muted-foreground">
                      {p.scope}
                      {p.conditions > 0 ? ` · ${p.conditions} condition${p.conditions === 1 ? "" : "s"}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Least-privilege review</p>
            <p className="mt-1 text-xs text-muted-foreground">{view.review.note}</p>
            {view.review.broadGrants.length === 0 && view.review.unusedGrants.length === 0 ? (
              <p className="mt-1 text-foreground">No broad or unused grants found.</p>
            ) : (
              <div className="mt-1 space-y-2">
                {view.review.broadGrants.length > 0 && (
                  <p>
                    <Badge tone="warning">Broad</Badge> <span className="text-foreground">{view.review.broadGrants.map((p) => p.action).join(", ")}</span>{" "}
                    <span className="text-xs text-muted-foreground">— allows a whole namespace for any resource.</span>
                  </p>
                )}
                {view.review.unusedGrants.length > 0 && (
                  <p>
                    <Badge tone="info">Unused in {view.review.windowDays} days</Badge>{" "}
                    <span className="text-foreground">{view.review.unusedGrants.map((p) => p.action).join(", ")}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is it doing, and what is normal?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-foreground">
            {agent.activityEvents7d.toLocaleString("en-US")} event{agent.activityEvents7d === 1 ? "" : "s"} and {decisionTotal.toLocaleString("en-US")} decision request{decisionTotal === 1 ? "" : "s"} this week.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ListBlock title="Tools" items={view.activity.tools} />
            <ListBlock title="Destinations" items={view.activity.destinations} />
          </div>
          <p className="text-muted-foreground">
            Baseline: {agent.baselineMaturity ? `${lower(agent.baselineMaturity)} (what is normal for this agent has been learned)` : "none yet, so behavior cannot be compared"}.{" "}
            <Link href={`/agents/${agent.slug}?tab=behavior`} className="text-foreground hover:underline">
              Behavior
            </Link>
          </p>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unusual this week</p>
            {view.deviations.length === 0 ? (
              <p className="text-foreground">Nothing unusual recorded.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {view.deviations.map((d) => (
                  <li key={d.id} className="text-foreground">
                    {lower(d.kind)} <span className="text-xs text-muted-foreground">({d.confidence.toLowerCase()} confidence · {formatRelativeTime(d.lastSeenAt)})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How risky, and does it need approval?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            Configured risk <RiskBadge level={agent.configuredRiskLevel} /> · trust{" "}
            <span className="text-foreground">{agent.trust ? `${lower(agent.trust.state)} (${agent.trust.score}/100)` : "not evaluated yet"}</span>
          </p>
          <p className="text-foreground">
            Risk assessed on decisions this week: {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((l) => `${view.risk7d.byLevel[l]} ${l.toLowerCase()}`).join(" · ")}.
            {view.risk7d.recommendedStricter > 0 && ` Aegis's risk engine recommended something stricter than what was returned for ${view.risk7d.recommendedStricter}.`}
          </p>
          <p className="text-foreground">
            Needs a human: {approvalPermissions.length + approvalPolicies.length === 0 ? "no permission or policy requires approval." : `${approvalPermissions.length} permission${approvalPermissions.length === 1 ? "" : "s"} and ${approvalPolicies.length} polic${approvalPolicies.length === 1 ? "y" : "ies"} require approval.`}{" "}
            {agent.pendingApprovals > 0 && (
              <Link href="/approvals" className="text-warning hover:underline">
                {agent.pendingApprovals} waiting now.
              </Link>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What did Aegis do, and what happened afterwards?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-foreground">
            Decisions returned this week: {decisions.ALLOW} allow · {decisions.ALERT} alert · {decisions.REQUIRE_APPROVAL} require approval · {decisions.BLOCK} block.
          </p>
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Enforcement coverage</p>
            <p className="mt-1 text-foreground">
              {agent.coverage.reportedActions === 0
                ? "No actions reported this week — there is no evidence of whether Aegis is in this agent's loop."
                : `${coverageText(agent.coverage)} of the actions this agent reported carried an Aegis decision; ${agent.coverage.undecided} never asked.`}
              {agent.coverage.ranDespite > 0 && <span className="text-danger"> {agent.coverage.ranDespite} ran although the decision was BLOCK or REQUIRE_APPROVAL.</span>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aegis is not in the agent&rsquo;s data path: it returns a decision and the integration chooses to honor it. Coverage is evidence of that, not proof; a low number means Aegis is advisory for this agent today.
            </p>
          </div>
          <p className="text-foreground">
            Incidents: {agent.openIncidents === 0 ? "none open." : <Link href="/incidents" className="text-danger hover:underline">{agent.openIncidents} open.</Link>}{" "}
            <Link href={`/agents/${agent.slug}?tab=graph`} className="text-muted-foreground hover:underline">
              See exactly what it did (action graph)
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle history</CardTitle>
        </CardHeader>
        <CardContent>
          {view.lifecycle.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lifecycle events are recorded for this agent (agents created before auditing began have none).</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {view.lifecycle.map((e) => (
                <li key={e.id}>
                  <span className="text-foreground">
                    {e.event}
                    {e.from && e.to ? ` (${lower(e.from)} → ${lower(e.to)})` : ""}
                  </span>
                  <span className="text-muted-foreground"> · {e.actor} · {formatDateTime(e.at)}</span>
                  {e.reason && <p className="text-xs text-muted-foreground">Reason: {e.reason}</p>}
                  {e.enforced === false && <p className="text-xs text-muted-foreground">Recorded in Aegis; no connector enforced it on the agent itself.</p>}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted-foreground">From the append-only audit trail.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: { key: string; count: number }[] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground">None reported.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {items.map((i) => (
            <li key={i.key} className="text-foreground">
              {i.key} <span className="text-xs text-muted-foreground">×{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
