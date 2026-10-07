import Link from "next/link";
import { Activity, ArrowRight, Bot, CheckCircle2, PlugZap, ScanSearch, ShieldAlert, ShieldCheck, Sparkles, UserCheck, type LucideIcon } from "lucide-react";

import type { ActivityItem, ActivityKind, ActivityTone } from "@/lib/overview/security-activity";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";

/**
 * The presentational pieces of Aegis Control. Everything here renders ONLY what it is given — figures are stored-row
 * counts (or null when unavailable, shown as an em dash), activity items are stored rows, and the empty states say
 * there is nothing rather than showing sample data.
 */

/** The Upgrade call to action. The destination and who sees it are decided by the caller; this only draws it. */
export function UpgradeCta({ className }: { className?: string }) {
  return (
    <Link href="/upgrade" className={cn("aegis-upgrade focus-ring group", className)}>
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
        <Sparkles className="size-4 transition-transform duration-200 group-hover:rotate-12" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-semibold leading-tight text-foreground">Upgrade</span>
        <span className="block text-xs leading-tight text-muted-foreground">Unlock advanced agent controls</span>
      </span>
      <ArrowRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

export type Figure = { label: string; value: number | null; href?: string; attention?: boolean };

/** One slim rail of real counts. Zero is shown as zero; unavailable is an em dash; nothing is colored unless it needs a person. */
export function StatusRail({ figures }: { figures: Figure[] }) {
  return (
    <section aria-label="Overview" className="overflow-hidden rounded-2xl border border-border bg-surface/70">
      {/* Each cell draws its own right/bottom hairline; the negative margins hide the ones on the outer edge, for any count. */}
      <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr">
        {figures.map((f) => {
          const body = (
            <>
              <p className="aegis-eyebrow">{f.label}</p>
              <p className={cn("num mt-1.5 text-2xl font-semibold leading-none tracking-tight", f.attention && (f.value ?? 0) > 0 ? "text-approval" : "text-foreground")}>{f.value ?? "—"}</p>
            </>
          );
          const cell = "border-b border-r border-border px-4 py-4";
          return f.href ? (
            <Link key={f.label} href={f.href} className={cn(cell, "focus-ring block transition-colors hover:bg-surface-muted")}>
              {body}
            </Link>
          ) : (
            <div key={f.label} className={cell}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Connect", text: "Give Aegis your agent's endpoint and the shared secret it uses." },
  { title: "Verify", text: "Aegis connects to the agent, and the agent proves it is the one you configured." },
  { title: "Scan and control", text: "Scan it, watch its activity, and decide what it may do." },
];

/** Shown when the organization has no connected agent. No sample agents: just the next step, and what Aegis does with it. */
export function EmptyAgents({ canManage, canScan }: { canManage: boolean; canScan: boolean }) {
  return (
    <section aria-labelledby="empty-agents-heading" className="aegis-rise rounded-3xl border border-border bg-surface/60 px-6 py-10 text-center sm:px-10 sm:py-14">
      <span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border-strong bg-surface-muted">
        <Bot className="size-5 text-accent" />
      </span>
      <h2 id="empty-agents-heading" className="mt-5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Connect your first AI agent
      </h2>
      <p className="mx-auto mt-3 max-w-md text-pretty text-muted-foreground">Bring a real AI agent into Aegis to monitor and control it from one place.</p>
      <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
        {canManage ? (
          <ButtonLink href="/agents/new" size="lg">
            <PlugZap className="size-4" aria-hidden="true" />
            Connect Agent
          </ButtonLink>
        ) : (
          <p className="text-sm text-muted-foreground">Ask an owner or admin to connect an agent.</p>
        )}
        {canScan && (
          <ButtonLink href="/risk-scan" size="lg" variant="secondary">
            <ScanSearch className="size-4" aria-hidden="true" />
            Connect an agent to start scanning
          </ButtonLink>
        )}
      </div>
      <ol className="mx-auto mt-10 grid max-w-3xl gap-5 text-left sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="border-t border-border pt-4">
            <p className="aegis-eyebrow">Step {i + 1}</p>
            <p className="mt-1.5 text-sm font-semibold text-foreground">{s.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export type QuickAction = { key: string; href: string; title: string; description: string; icon: LucideIcon };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="aegis-eyebrow mb-3 px-1">
        Quick actions
      </h2>
      <ul className="grid gap-2.5">
        {actions.map(({ key, href, title, description, icon: Icon }) => (
          <li key={key}>
            <Link href={href} className="aegis-action focus-ring group">
              <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground transition-colors group-hover:text-accent">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
              <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_ICON: Record<ActivityKind, LucideIcon> = { alert: ShieldAlert, connection: CheckCircle2, decision: ShieldCheck, approval: UserCheck };
const KIND_LABEL: Record<ActivityKind, string> = { alert: "Security alert", connection: "Connection", decision: "Decision", approval: "Approval" };
const TONE_TEXT: Record<ActivityTone, string> = { neutral: "text-muted-foreground", success: "text-success", warning: "text-warning", danger: "text-danger", approval: "text-approval" };

/** Real recent events only. Empty means empty: "No security activity yet." */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section aria-labelledby="activity-heading">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 id="activity-heading" className="aegis-eyebrow">
          Security activity
        </h2>
        <Link href="/activity" className="focus-ring rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground">
          View all activity
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-5 py-8">
          <Activity aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">No security activity yet.</p>
            <p className="text-sm text-muted-foreground">Alerts, connections, decisions and approvals appear here as they happen.</p>
          </div>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border bg-surface/60">
          {items.map((item, i) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.id} className={cn(i > 0 && "border-t border-border")}>
                <Link href={item.href} className="focus-ring group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted">
                  <span className={cn("mt-0.5 shrink-0", TONE_TEXT[item.tone])}>
                    <Icon aria-hidden="true" className="size-4" />
                    <span className="sr-only">{KIND_LABEL[item.kind]}: </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                  <time dateTime={item.at.toISOString()} className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                    {formatRelativeTime(item.at)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
