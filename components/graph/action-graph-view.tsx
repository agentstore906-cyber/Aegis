import Link from "next/link";
import { ArrowLeft, Network } from "lucide-react";

import { RiskBadge } from "@/components/dashboard/status-badges";
import { ActionTimeline } from "@/components/graph/action-timeline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { RunGraph, RunList } from "@/lib/graph/queries";
import type { ItemFlag } from "@/lib/graph/types";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

const graphHref = (slug: string, params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams({ tab: "graph" });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/agents/${slug}?${q.toString()}`;
};

const duration = (ms: number) => {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

export function RunListView({ slug, list }: { slug: string; list: RunList }) {
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Each run is one trace: the actions an agent took together, from its first decision to its last reported result. Open
        one to see exactly what happened, in order. Showing the last {list.windowDays} days.
      </p>

      {list.runs.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No runs in this window"
          description="Runs appear once the agent reports activity or asks for decisions with a trace id (Aegis assigns one to every decision)."
        />
      ) : (
        <ul className="space-y-2">
          {list.runs.map((run) => (
            <li key={run.traceId}>
              <Link
                href={graphHref(slug, { trace: run.traceId })}
                className="focus-ring block rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{run.firstAction?.replaceAll("_", " ") ?? "Run"}</span>
                  {run.taskId && <span className="text-xs text-muted-foreground">task {run.taskId}</span>}
                  <RiskBadge level={run.maxRisk} />
                  {run.blocked > 0 && <Badge tone="danger">{run.blocked} blocked</Badge>}
                  {run.approvalRequired > 0 && <Badge tone="warning">{run.approvalRequired} needed approval</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.events} event{run.events === 1 ? "" : "s"} · {run.tools} tool{run.tools === 1 ? "" : "s"} · {run.destinations} destination
                  {run.destinations === 1 ? "" : "s"} · {formatRelativeTime(run.lastAt)} · {duration(run.lastAt.getTime() - run.firstAt.getTime())} long
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{run.traceId}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.nextCursor && (
        <p className="mt-4">
          <Link href={graphHref(slug, { rcursor: list.nextCursor })} className="text-sm text-foreground hover:underline">
            Older runs →
          </Link>
        </p>
      )}
      {list.scanTruncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          This agent produced more events in the window than Aegis scans for this list, so the oldest runs shown may be partial. Open a run for its exact totals.
        </p>
      )}
      {list.ungroupedEvents > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {list.ungroupedEvents} event{list.ungroupedEvents === 1 ? "" : "s"} in this window carried no trace id, so they belong to no run. They are in the{" "}
          <Link href={graphHref(slug, {}).replace("tab=graph", "tab=activity")} className="hover:underline">
            activity feed
          </Link>
          .
        </p>
      )}
    </div>
  );
}

const ATTENTION_LABEL: Record<ItemFlag, string> = {
  blocked: "blocked decision",
  approval_required: "approval required",
  approval_pending: "approval pending",
  risk_gated: "gated by risk control",
  executed_despite_decision: "reported executed despite decision",
  high_risk: "high risk",
  behavioral_deviation: "unusual for this agent",
};

export function RunGraphView({ slug, run }: { slug: string; run: RunGraph }) {
  const { stats, graph, page } = run;
  const chips = (entries: { key: string; count: number }[]) =>
    entries.length === 0 ? (
      <span className="text-muted-foreground">none reported</span>
    ) : (
      entries.map((e) => (
        <span key={e.key} className="mr-1.5 inline-block rounded border border-border bg-surface-muted px-1.5 py-0.5 text-xs text-foreground">
          {e.key} <span className="text-muted-foreground">×{e.count}</span>
        </span>
      ))
    );

  return (
    <div>
      <Link href={graphHref(slug, {})} className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All runs
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Run</h2>
        <span className="font-mono text-xs text-muted-foreground">{run.traceId}</span>
        <RiskBadge level={stats.maxRisk} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {stats.events.toLocaleString("en-US")} events · {formatDateTime(stats.firstAt)} · {duration(stats.lastAt.getTime() - stats.firstAt.getTime())} · {stats.byStatus.BLOCKED ?? 0} blocked ·{" "}
        {stats.byStatus.APPROVAL_REQUIRED ?? 0} needed approval · {stats.byStatus.FAILED ?? 0} failed
      </p>

      <Card>
        <CardHeader>
          <CardTitle>What this run touched</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="End users">{stats.endUsers > 0 ? `${stats.endUsers} (pseudonymized)` : <span className="text-muted-foreground">none reported</span>}</Row>
            <Row label="Tasks">{stats.taskIds.length > 0 ? stats.taskIds.join(", ") : <span className="text-muted-foreground">none reported (the run is the task)</span>}</Row>
            <Row label="Tools">{chips(stats.tools)}</Row>
            <Row label="APIs / destinations">{chips(stats.destinations)}</Row>
            <Row label="Data">{chips(stats.dataClasses)}</Row>
            <Row label="Decisions">
              {Object.keys(stats.decisions).length === 0 ? (
                <span className="text-muted-foreground">none in this run</span>
              ) : (
                Object.entries(stats.decisions).map(([k, v]) => (
                  <span key={k} className="mr-1.5 inline-block rounded border border-border bg-surface-muted px-1.5 py-0.5 text-xs text-foreground">
                    {k.replaceAll("_", " ").toLowerCase()} <span className="text-muted-foreground">×{v}</span>
                  </span>
                ))
              )}
            </Row>
          </dl>
        </CardContent>
      </Card>

      {graph.attention.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Needs attention{page.nextCursor || page.cursor ? " (on this page)" : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {graph.attention.slice(0, 25).map((a) => {
                const item = findItem(graph.timeline, a.id);
                return (
                  <li key={a.id}>
                    <a href={`#evt-${a.id}`} className="text-foreground hover:underline">
                      {item?.event.action.replaceAll("_", " ") ?? a.id}
                    </a>{" "}
                    <span className="text-xs text-muted-foreground">{a.flags.map((f) => ATTENTION_LABEL[f]).join(" · ")}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Timeline</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          In the order Aegis received them; each action is nested under the one that caused it. Offsets are from the start of the run. Open a row for its context, decision, risk and approvals.
        </p>
        {graph.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events on this page.</p>
        ) : (
          <ActionTimeline items={graph.timeline} agentName={run.agent.name} agentSlug={run.agent.slug} traceId={run.traceId} runStart={stats.firstAt} />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Showing {page.returned.toLocaleString("en-US")} of {stats.events.toLocaleString("en-US")} events{page.cursor ? " (continued)" : ""}
          {graph.counts.orphans > 0 ? ` · ${graph.counts.orphans} start${graph.counts.orphans === 1 ? "s" : ""} here because its parent is elsewhere` : ""}.
        </span>
        <span className="flex gap-4">
          {page.cursor && (
            <Link href={graphHref(slug, { trace: run.traceId })} className="text-foreground hover:underline">
              ← Start of run
            </Link>
          )}
          {page.nextCursor && (
            <Link href={graphHref(slug, { trace: run.traceId, cursor: page.nextCursor })} className="text-foreground hover:underline">
              Next events →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function findItem(items: RunGraph["graph"]["timeline"], id: string): RunGraph["graph"]["timeline"][number] | null {
  const stack = [...items];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.id === id) return item;
    stack.push(...item.children);
  }
  return null;
}
