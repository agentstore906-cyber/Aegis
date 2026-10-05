import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAgents } from "@/lib/agents/queries";
import { getAgentListSignals } from "@/lib/agents/list-signals";
import { canManageAgents } from "@/lib/agents/authorization";
import { getApprovalStats } from "@/lib/approvals/repository";
import { searchIncidents } from "@/lib/incidents/service";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { agentFiltersSchema } from "@/lib/validation/agent";
import type { ConnectionState } from "@/lib/agents/connection-state";

import { StateLine, type PanelTone } from "@/components/console/primitives";
import { AgentStatusBadge } from "@/components/dashboard/status-badges";
import { ButtonLink } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";

export const metadata: Metadata = { title: { absolute: "Aegis" } };

const CONNECTION_TONE: Record<ConnectionState, PanelTone> = {
  CONNECTED: "safe",
  WAITING: "neutral",
  CREDENTIAL_VERIFIED: "neutral",
  NOT_SEEN_RECENTLY: "warning",
  ERROR: "warning",
  REVOKED: "blocked",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Home. Deliberately almost empty: the agents the organization really has, and the three things worth doing
 * next. Everything else (risk, activity, policies, approvals, incidents, audit, control) is one click away
 * through the Aegis menu or inside an agent. No figure on this page is anything but a count from the database.
 */
export default async function HomePage() {
  const { organization, role, user } = await requireActiveOrganization();
  const canManage = canManageAgents(role);
  const canSecurity = canViewSecurityAlerts(role);

  const { agents: rows, total } = await listAgents(organization.id, agentFiltersSchema.parse({}));
  const live = rows.filter((a) => a.status !== "ARCHIVED");
  const signals = await getAgentListSignals(
    organization.id,
    live.map((a) => a.id)
  );

  // The one thing that can hold an agent up is a person: so it is the only status line, and only when non-zero.
  const [approvals, incidents] =
    live.length > 0
      ? await Promise.all([
          getApprovalStats(organization.id),
          canSecurity ? searchIncidents({ organizationId: organization.id, userId: user.id, role }, { status: ["OPEN", "INVESTIGATING"], pageSize: 1 }) : Promise.resolve(null),
        ])
      : [null, null];
  const waiting = [
    approvals && approvals.pending > 0 ? { href: "/approvals", text: `${plural(approvals.pending, "approval")} waiting` } : null,
    incidents && incidents.total > 0 ? { href: "/incidents", text: `${plural(incidents.total, "open incident")}` } : null,
  ].filter((x): x is { href: string; text: string } => x !== null);

  // ── No agents ──────────────────────────────────────────────────────────────────────────────────
  if (live.length === 0) {
    return (
      <div className="aegis-enter mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center pb-16 text-center">
        <LogoMark className="size-9" />
        <h1 className="mt-6 text-3xl font-semibold text-foreground">Control your AI agents.</h1>
        <p className="mt-2 text-muted-foreground">Your agent stays yours. Aegis becomes its control layer.</p>
        <div className="mt-8 flex w-full flex-col gap-2.5">
          {canManage ? (
            <ButtonLink href="/agents/new" size="lg">
              Connect agent
            </ButtonLink>
          ) : (
            <p className="text-sm text-muted-foreground">Ask an owner or admin to connect an agent.</p>
          )}
          <ButtonLink href="/scan?from=dashboard" variant="secondary" size="lg">
            Risk scanner
          </ButtonLink>
        </div>
      </div>
    );
  }

  // ── One or more agents ─────────────────────────────────────────────────────────────────────────
  const single = live.length === 1 ? live[0] : null;
  const connectionOf = (id: string) => signals.get(id)?.connection;

  return (
    <div className="aegis-enter mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center pb-16 text-center">
      {single ? (
        <>
          <p className="text-sm text-muted-foreground">Your AI agent</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">{single.name}</h1>
          <div className="mt-3 flex items-center gap-2">
            {connectionOf(single.id) && <StateLine tone={CONNECTION_TONE[connectionOf(single.id)!.state]}>{connectionOf(single.id)!.label}</StateLine>}
            {single.status !== "ACTIVE" && <AgentStatusBadge status={single.status} />}
          </div>
          <div className="mt-8">
            <ButtonLink href={`/agents/${single.slug}`} size="lg">
              Open agent
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold text-foreground">Your AI agents</h1>
          <ul
            aria-label="Your AI agents"
            className={`mt-8 w-full divide-y divide-border rounded-xl border border-border text-left ${live.length > 3 ? "max-h-72 overflow-y-auto" : ""}`}
          >
            {live.map((agent) => {
              const c = connectionOf(agent.id);
              return (
                <li key={agent.id}>
                  <Link href={`/agents/${agent.slug}`} className="focus-ring flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted">
                    <span className="min-w-0 truncate font-medium text-foreground">{agent.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-sm">
                      {agent.status !== "ACTIVE" && <AgentStatusBadge status={agent.status} />}
                      {c && <StateLine tone={CONNECTION_TONE[c.state]}>{c.label}</StateLine>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {total > rows.length && (
            <p className="mt-3 text-sm">
              <Link href="/agents" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                View all {total} agents
              </Link>
            </p>
          )}
        </>
      )}

      {waiting.length > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          {waiting.map((w, i) => (
            <span key={w.href}>
              {i > 0 && " · "}
              <Link href={w.href} className="text-foreground underline underline-offset-4">
                {w.text}
              </Link>
            </span>
          ))}
        </p>
      )}

      <div className="mt-8 flex w-full flex-col gap-2.5">
        {canManage && (
          <ButtonLink href="/agents/new" variant="secondary" size="lg">
            <Plus className="size-4" aria-hidden="true" />
            Connect another agent
          </ButtonLink>
        )}
        <ButtonLink href="/scan?from=dashboard" variant="secondary" size="lg">
          Risk scanner
        </ButtonLink>
      </div>
    </div>
  );
}
