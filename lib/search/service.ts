import "server-only";

import type { MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * Global search over the real entities of ONE organization: agents, policies,
 * approvals, incidents, security alerts, activity events and audit events.
 *
 *  - Tenant isolation: every query filters on the caller's organizationId, which
 *    comes from the authenticated membership — never from the request.
 *  - Authorization: groups the caller's role may not view (incidents and alerts need
 *    `view_security`; audit needs `view_audit`) are not queried at all, so their
 *    existence is not revealed by the result shape either.
 *  - Bounded: a minimum query length, a maximum query length, a fixed number of
 *    results per type, one narrow `select` per type, and activity search is limited
 *    to the last 30 days. Nothing here scans an unbounded history.
 *  - Truthful: a failing query makes the whole search fail (the caller shows
 *    "search is unavailable"); it never returns a partial list as if complete.
 *  - Reads only. No result exposes more than a title, a subtitle and a link.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
export const SEARCH_PER_TYPE = 5;
const ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type SearchResultType = "agent" | "policy" | "approval" | "incident" | "alert" | "event" | "audit";

export type SearchResult = { type: SearchResultType; id: string; title: string; subtitle: string; href: string };
export type SearchGroup = { type: SearchResultType; label: string; results: SearchResult[] };
export type SearchResponse = { query: string; groups: SearchGroup[] };
export type SearchActor = { organizationId: string; role: MemberRole };

const LABELS: Record<SearchResultType, string> = {
  agent: "Agents",
  policy: "Policies",
  approval: "Approvals",
  incident: "Incidents",
  alert: "Security alerts",
  event: "Activity",
  audit: "Audit",
};

/** Trims, collapses whitespace and caps length. Returns null when the query is too short to search. */
export function normalizeQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

/** Prisma passes `%` and `_` through to LIKE unescaped; a query of "%%" would otherwise match every row. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

const lower = (s: string) => s.replaceAll("_", " ").toLowerCase();

export async function searchWorkspace(actor: SearchActor, rawQuery: string): Promise<SearchResponse> {
  const q = normalizeQuery(rawQuery);
  if (q === null) return { query: rawQuery.trim().slice(0, SEARCH_MAX_LENGTH), groups: [] };

  const organizationId = actor.organizationId;
  const canSecurity = hasCapability(actor.role, "view_security");
  const canAudit = hasCapability(actor.role, "view_audit");
  const like = escapeLike(q);
  const contains = { contains: like, mode: "insensitive" as const };
  const incidentNumber = /^inc-?(\d{1,9})$/i.exec(q);
  const since = new Date(Date.now() - ACTIVITY_WINDOW_MS);
  const take = SEARCH_PER_TYPE;

  const [agents, policies, approvals, incidents, alerts, events, audit] = await Promise.all([
    prisma.agent.findMany({
      where: { organizationId, OR: [{ name: contains }, { slug: contains }, { owner: contains }] },
      orderBy: { name: "asc" },
      take,
      select: { id: true, name: true, slug: true, owner: true, environment: true, status: true },
    }),
    prisma.policy.findMany({
      where: { organizationId, OR: [{ name: contains }, { action: contains }] },
      orderBy: { updatedAt: "desc" },
      take,
      select: { id: true, name: true, action: true, decision: true, status: true },
    }),
    prisma.approvalRequest.findMany({
      where: { organizationId, OR: [{ action: contains }, { id: { startsWith: like } }] },
      orderBy: { requestedAt: "desc" },
      take,
      select: { id: true, action: true, status: true, agent: { select: { name: true } } },
    }),
    canSecurity
      ? prisma.incident.findMany({
          where: { organizationId, OR: [{ title: contains }, ...(incidentNumber ? [{ number: Number(incidentNumber[1]) }] : [])] },
          orderBy: { openedAt: "desc" },
          take,
          select: { id: true, number: true, title: true, status: true, agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    canSecurity
      ? prisma.securityAlert.findMany({
          where: { organizationId, title: contains },
          orderBy: { lastSeenAt: "desc" },
          take,
          select: { id: true, title: true, severity: true, status: true, agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.activityEvent.findMany({
      where: { organizationId, timestamp: { gte: since }, OR: [{ action: contains }, { resource: contains }] },
      orderBy: { timestamp: "desc" },
      take,
      select: { id: true, action: true, resource: true, source: true, status: true, agent: { select: { name: true } } },
    }),
    canAudit
      ? prisma.auditEvent.findMany({
          where: { organizationId, OR: [{ action: contains }, { eventType: contains }, { entityId: q }] },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, action: true, eventType: true, entityType: true },
        })
      : Promise.resolve([]),
  ]);

  const groups: SearchGroup[] = [
    {
      type: "agent",
      label: LABELS.agent,
      results: agents.map((a) => ({ type: "agent", id: a.id, title: a.name, subtitle: `${a.owner} · ${lower(a.environment)} · ${lower(a.status)}`, href: `/agents/${a.slug}` })),
    },
    {
      type: "incident",
      label: LABELS.incident,
      results: incidents.map((i) => ({ type: "incident", id: i.id, title: `INC-${i.number} ${i.title}`, subtitle: `${i.agent.name} · ${lower(i.status)}`, href: `/incidents/${i.id}` })),
    },
    {
      type: "approval",
      label: LABELS.approval,
      results: approvals.map((a) => ({ type: "approval", id: a.id, title: a.action, subtitle: `${a.agent.name} · ${lower(a.status)}`, href: `/approvals/${a.id}` })),
    },
    {
      type: "policy",
      label: LABELS.policy,
      results: policies.map((p) => ({ type: "policy", id: p.id, title: p.name, subtitle: `${p.action} · ${lower(p.decision)} · ${lower(p.status)}`, href: `/policies/${p.id}/edit` })),
    },
    {
      type: "alert",
      label: LABELS.alert,
      results: alerts.map((a) => ({ type: "alert", id: a.id, title: a.title, subtitle: `${a.agent.name} · ${lower(a.severity)} · ${lower(a.status)}`, href: `/security/${a.id}` })),
    },
    {
      type: "event",
      label: LABELS.event,
      results: events.map((e) => ({ type: "event", id: e.id, title: e.action, subtitle: `${e.agent.name}${e.resource ? ` · ${e.resource}` : ""}`, href: `/activity/${e.id}` })),
    },
    {
      type: "audit",
      label: LABELS.audit,
      results: audit.map((a) => ({ type: "audit", id: a.id, title: a.action, subtitle: `${a.eventType} · ${a.entityType}`, href: `/audit/${a.id}` })),
    },
  ].filter((g) => g.results.length > 0) as SearchGroup[];

  return { query: q, groups };
}
