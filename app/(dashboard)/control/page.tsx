import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Eye, FileWarning, KeyRound, OctagonX, ShieldAlert, ShieldQuestion, Siren, UserX, Waves, Activity, UserCheck } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { getInventory, type InventoryFilters } from "@/lib/control/inventory";
import { ATTENTION_FLAG_LABEL, type AgentPosture, type AttentionFlag } from "@/lib/control/posture";
import { formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { FlagBadges, PostureBadge, coverageText, postureLabel } from "@/components/control/control-badges";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "Control plane" };

type SearchParams = Record<string, string | string[] | undefined>;
const ENVIRONMENTS = ["PRODUCTION", "STAGING", "DEVELOPMENT"] as const;
const STATUSES = ["ACTIVE", "PAUSED", "STOPPED", "NEEDS_ATTENTION", "ARCHIVED"] as const;
const POSTURES: AgentPosture[] = ["PROTECTED", "OBSERVED", "QUIET", "DISCOVERED", "NEEDS_ATTENTION", "PAUSED", "STOPPED", "RETIRED"];
const FLAGS = Object.keys(ATTENTION_FLAG_LABEL) as AttentionFlag[];

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneOf = <T extends string>(v: string | string[] | undefined, options: readonly T[]) => {
  const s = one(v);
  return s && (options as readonly string[]).includes(s) ? (s as T) : undefined;
};

export default async function ControlPlanePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewSecurityAlerts(role)) notFound();
  const raw = await searchParams;

  const filters: InventoryFilters = {
    environment: oneOf(raw.environment, ENVIRONMENTS),
    status: oneOf(raw.status, STATUSES),
    posture: oneOf(raw.posture, POSTURES),
    flag: oneOf(raw.flag, FLAGS),
    q: one(raw.q),
    page: Number.parseInt(one(raw.page) ?? "1", 10) || 1,
  };
  const inventory = await getInventory(organization.id, filters);
  const { summary } = inventory;
  const filtered = Boolean(filters.environment || filters.status || filters.posture || filters.flag || filters.q);

  const buildHref = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v && k !== "page") q.set(k, v);
    q.set("page", String(page));
    return `/control?${q.toString()}`;
  };
  const tile = (flag: AttentionFlag) => `/control?flag=${flag}`;

  return (
    <div>
      <PageHeader
        title="Control plane"
        description={`Every agent in ${organization.name}: who owns it, what it may do, what it is doing, how trusted and risky it is, and whether Aegis is actually in its loop. Counts cover the last ${summary.windowDays} days.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Agents" value={String(summary.total)} icon={Bot} />
        <StatCard label={`Owners (${summary.unowned} agent${summary.unowned === 1 ? "" : "s"} unowned)`} value={String(summary.owners)} icon={UserX} tone={summary.unowned ? "warning" : undefined} />
        <StatCard label="High risk" value={String(summary.highRisk)} icon={ShieldAlert} tone={summary.highRisk ? "danger" : undefined} />
        <StatCard label="Behaving unusually" value={String(summary.unusualBehavior)} icon={Waves} tone={summary.unusualBehavior ? "warning" : undefined} />
        <StatCard label="Stopped or paused" value={String(summary.stoppedOrPaused)} icon={OctagonX} />
        <StatCard label="Waiting on approval" value={String(summary.needingApproval)} icon={UserCheck} tone={summary.needingApproval ? "warning" : undefined} />
        <StatCard label="With open incidents" value={String(summary.withOpenIncidents)} icon={Siren} tone={summary.withOpenIncidents ? "danger" : undefined} />
        <StatCard label="Nothing granted yet" value={String(summary.nothingGranted)} icon={ShieldQuestion} tone={summary.nothingGranted ? "warning" : undefined} />
        <StatCard label="Observed, never asking Aegis" value={String(summary.observeOnly)} icon={Eye} />
        <StatCard label="Ran despite a decision" value={String(summary.ranDespiteDecision)} icon={FileWarning} tone={summary.ranDespiteDecision ? "danger" : undefined} />
        <StatCard label="Identity is a shared key" value={String(summary.sharedKeyIdentity)} icon={KeyRound} tone={summary.sharedKeyIdentity ? "warning" : undefined} />
        <StatCard label="Active this week" value={String(summary.total - (summary.byPosture.QUIET ?? 0) - (summary.byPosture.RETIRED ?? 0))} icon={Activity} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Every tile is a count of stored rows.{" "}
        {[
          ["high risk", "HIGH_RISK"],
          ["unusual", "UNUSUAL_BEHAVIOR"],
          ["needs approval", "PENDING_APPROVAL"],
          ["incidents", "OPEN_INCIDENT"],
          ["ran despite a decision", "RAN_DESPITE_DECISION"],
          ["shared-key identity", "SHARED_IDENTITY"],
        ].map(([label, flag], i) => (
          <span key={flag}>
            {i > 0 && " · "}
            <Link href={tile(flag as AttentionFlag)} className="hover:underline">
              show {label}
            </Link>
          </span>
        ))}
        . &ldquo;Asks Aegis&rdquo; means an agent asks Aegis for decisions; how much of what it does goes through one is its <em>enforcement coverage</em> — Aegis returns decisions, it cannot stop an integration that does not honor them.
      </p>

      <form method="get" className="mt-6 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={filters.q ?? ""} placeholder="name, slug or owner" />
          </div>
          <Sel label="Environment" name="environment" value={filters.environment} options={ENVIRONMENTS.map((e) => [e, e.toLowerCase()])} />
          <Sel label="Lifecycle" name="status" value={filters.status} options={STATUSES.map((s) => [s, s.replaceAll("_", " ").toLowerCase()])} />
          <Sel label="Posture" name="posture" value={filters.posture} options={POSTURES.map((p) => [p, postureLabel(p).toLowerCase()])} />
          <Sel label="Needs attention for" name="flag" value={filters.flag} options={FLAGS.map((f) => [f, ATTENTION_FLAG_LABEL[f].toLowerCase()])} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" size="sm">
            Filter
          </Button>
          {filtered && (
            <Link href="/control" className="text-sm text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </div>
      </form>

      {inventory.truncated && (
        <p className="mt-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
          This organization has more agents than the control view examines at once; the most recently created are shown and counted.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface">
        {inventory.agents.length === 0 ? (
          <EmptyState icon={Bot} title={filtered ? "No agents match" : "No agents yet"} description={filtered ? "Try widening the filters." : "Connect an agent to see it here."} />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Agent</Th>
                <Th>Owner</Th>
                <Th>Posture</Th>
                <Th>Access</Th>
                <Th>Trust</Th>
                <Th>Coverage</Th>
                <Th>Needs attention</Th>
              </Tr>
            </Thead>
            <Tbody>
              {inventory.agents.map((a) => (
                <Tr key={a.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link href={`/agents/${a.slug}?tab=control`} className="font-medium text-foreground hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.environment.toLowerCase()} · {a.lastActiveAt ? `active ${formatRelativeTime(a.lastActiveAt)}` : "never active"}
                    </p>
                  </Td>
                  <Td className="text-sm">{a.owner}</Td>
                  <Td>
                    <PostureBadge posture={a.posture} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {a.access.total === 0 ? (
                      "nothing granted"
                    ) : (
                      <>
                        {a.access.allow} allow · {a.access.requireApproval} approval · {a.access.block} block
                      </>
                    )}
                  </Td>
                  <Td className="text-sm">{a.trust ? `${a.trust.state.replaceAll("_", " ").toLowerCase()} (${a.trust.score})` : "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{coverageText(a.coverage)}</Td>
                  <Td>
                    <FlagBadges flags={a.attention} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        <Pagination page={inventory.page} pageCount={inventory.pageCount} buildHref={buildHref} />
      </div>
    </div>
  );
}

function Sel({ label, name, value, options }: { label: string; name: string; value: string | undefined; options: string[][] }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} defaultValue={value ?? ""}>
        <option value="">Any</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
}
