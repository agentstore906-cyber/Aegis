import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Siren } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { canViewIncidents } from "@/lib/incidents/authorization";
import { incidentStatusCounts, searchIncidents, type IncidentFilters } from "@/lib/incidents/service";
import { formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { RiskBadge } from "@/components/dashboard/status-badges";
import { StatusBadge } from "@/components/incidents/incident-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Incidents" };

type SearchParams = Record<string, string | string[] | undefined>;
const STATUSES = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const DECISIONS = ["ALLOW", "ALERT", "REQUIRE_APPROVAL", "BLOCK"] as const;

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneOf = <T extends string>(v: string | string[] | undefined, options: readonly T[]) => {
  const s = one(v);
  return s && (options as readonly string[]).includes(s) ? (s as T) : undefined;
};
const dateOf = (v: string | string[] | undefined, endOfDay = false) => {
  const s = one(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canViewIncidents(role)) notFound();
  const actor = { organizationId: organization.id, userId: user.id, role };
  const raw = await searchParams;

  const status = oneOf(raw.status, STATUSES);
  const severity = oneOf(raw.severity, SEVERITIES);
  const decision = oneOf(raw.decision, DECISIONS);
  const ack = oneOf(raw.ack, ["yes", "no"] as const);
  const filters: IncidentFilters = {
    status: status ? [status] : undefined,
    severity: severity ? [severity] : undefined,
    agentId: one(raw.agent),
    policyId: one(raw.policy),
    decision,
    destination: one(raw.destination),
    tool: one(raw.tool),
    from: dateOf(raw.from),
    to: dateOf(raw.to, true),
    acknowledged: ack === "yes" ? true : ack === "no" ? false : undefined,
    page: Number.parseInt(one(raw.page) ?? "1", 10) || 1,
  };

  const [result, counts, agents, policies] = await Promise.all([
    searchIncidents(actor, filters),
    incidentStatusCounts(actor),
    listAllAgentsForOrg(organization.id),
    prisma.policy.findMany({ where: { organizationId: organization.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
  ]);

  const buildHref = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v && k !== "page") q.set(k, v);
    q.set("page", String(page));
    return `/incidents?${q.toString()}`;
  };
  const filtered = Object.values({ ...filters, page: undefined }).some((v) => v !== undefined);

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="What happened, why, what Aegis did, and the evidence — reconstructed from stored telemetry. Incidents open automatically when a security alert is raised, or from any alert or decision."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={String(counts.OPEN)} icon={Siren} tone={counts.OPEN ? "danger" : undefined} />
        <StatCard label="Investigating" value={String(counts.INVESTIGATING)} icon={Siren} tone={counts.INVESTIGATING ? "warning" : undefined} />
        <StatCard label="Resolved" value={String(counts.RESOLVED)} icon={Siren} />
        <StatCard label="False positive" value={String(counts.FALSE_POSITIVE)} icon={Siren} />
      </div>

      <form method="get" className="mt-6 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status" name="status" value={status}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Field>
          <Field label="Severity" name="severity" value={severity}>
            <option value="">Any</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Field>
          <Field label="Agent" name="agent" value={filters.agentId}>
            <option value="">Any</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Field>
          <Field label="Policy involved" name="policy" value={filters.policyId}>
            <option value="">Any</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Field>
          <Field label="Decision in the run" name="decision" value={decision}>
            <option value="">Any</option>
            {DECISIONS.map((d) => (
              <option key={d} value={d}>
                {d.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Field>
          <Field label="Acknowledged" name="ack" value={ack}>
            <option value="">Any</option>
            <option value="yes">Acknowledged</option>
            <option value="no">Not yet</option>
          </Field>
          <div>
            <Label htmlFor="destination">Destination (exact host)</Label>
            <Input id="destination" name="destination" defaultValue={filters.destination ?? ""} placeholder="api.example.com" />
          </div>
          <div>
            <Label htmlFor="tool">Tool (exact key)</Label>
            <Input id="tool" name="tool" defaultValue={filters.tool ?? ""} placeholder="crm" />
          </div>
          <div>
            <Label htmlFor="from">Opened from</Label>
            <Input id="from" name="from" type="date" defaultValue={one(raw.from) ?? ""} />
          </div>
          <div>
            <Label htmlFor="to">Opened to</Label>
            <Input id="to" name="to" type="date" defaultValue={one(raw.to) ?? ""} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" size="sm">
            Search
          </Button>
          {filtered && (
            <Link href="/incidents" className="text-sm text-muted-foreground hover:text-foreground">
              Clear filters
            </Link>
          )}
          <span className="text-xs text-muted-foreground">Searches this organization only. Policy, decision, destination and tool match anything recorded in the incident&rsquo;s run.</span>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border bg-surface">
        {result.incidents.length === 0 ? (
          <EmptyState
            icon={Siren}
            title={filtered ? "No incidents match" : "No incidents yet"}
            description={filtered ? "Try widening the filters." : "An incident opens automatically when a security alert is raised. You can also open one from any alert or decision."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {result.incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/incidents/${i.id}`} className="focus-ring block px-4 py-3 hover:bg-surface-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">INC-{i.number}</span>
                    <StatusBadge status={i.status} />
                    <RiskBadge level={i.severity} />
                    <span className="font-medium text-foreground">{i.title}</span>
                    {i.acknowledgedAt && <span className="text-xs text-muted-foreground">acknowledged</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {i.agent.name} · opened {formatRelativeTime(i.openedAt)} · {i.openedVia === "ALERT_TRIGGER" ? "from a security alert" : "opened by an operator"}
                    {i.traceId ? "" : " · no run linked"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={result.page} pageCount={result.pageCount} buildHref={buildHref} />
      </div>
    </div>
  );
}

function Field({ label, name, value, children }: { label: string; name: string; value: string | undefined; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} defaultValue={value ?? ""}>
        {children}
      </Select>
    </div>
  );
}
