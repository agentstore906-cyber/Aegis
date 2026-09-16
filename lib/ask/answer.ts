import "server-only";

import { listActivityEvents } from "@/lib/activity/queries";
import { getSpendSummary, getSpendByAgent } from "@/lib/costs/queries";
import { listSecurityAlertsByType, listRecentAnomalies, getHighRiskAgentsSummary } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { listPolicyEvaluations } from "@/lib/policies/repository";
import { listApprovalRequests } from "@/lib/approvals/repository";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { AskAnswer, EvidenceItem } from "@/lib/ask/types";

/**
 * Ask Aegis (spec §7): a deterministic, evidence-grounded query router —
 * NOT a freeform LLM. Every intent below runs a real, already-existing,
 * organization-scoped query (the same functions the dashboard itself
 * uses) and returns exactly what those queries found. There is no
 * generative step that could hallucinate a fact, and no user- or
 * agent-controlled text is ever interpolated into a prompt sent to a
 * model — so there is no prompt-injection surface to defend here by
 * construction, not by a filter that could be bypassed.
 *
 * `organizationId` must always come from the caller's authenticated
 * session (see lib/ask/actions.ts) — this module never trusts a
 * client-supplied org.
 */

const NO_EVIDENCE_ANSWER = "I don't have enough evidence to determine that.";

type IntentHandler = (organizationId: string) => Promise<AskAnswer>;

type Intent = {
  id: string;
  patterns: RegExp[];
  handler: IntentHandler;
};

function activityEvidence(event: {
  id: string;
  action: string;
  resource: string | null;
  timestamp: Date;
  agent: { name: string; slug: string };
}): EvidenceItem {
  return {
    type: "activity_event",
    label: `${event.agent.name} — ${event.action}`,
    detail: event.resource ?? undefined,
    href: `/activity/${event.id}`,
    timestamp: event.timestamp,
  };
}

const INTENTS: Intent[] = [
  {
    id: "blocked_actions",
    patterns: [/\bblocked\b/i],
    handler: async (organizationId) => {
      const { evaluations, total } = await listPolicyEvaluations(organizationId, { decision: "BLOCK", page: 1 });
      if (total === 0) {
        return { intent: "blocked_actions", summary: "No actions have been blocked by policy.", evidence: [] };
      }
      return {
        intent: "blocked_actions",
        summary: `${total} action${total === 1 ? " has" : "s have"} been blocked by policy. Most recent: "${evaluations[0]!.action}" by ${evaluations[0]!.agent.name}.`,
        evidence: evaluations.slice(0, 5).map((e) => ({
          type: "policy_evaluation" as const,
          label: `${e.agent.name} — ${e.action}`,
          detail: e.reason,
          href: `/policies/evaluations/${e.id}`,
          timestamp: e.createdAt,
        })),
      };
    },
  },
  {
    id: "approval_required",
    patterns: [/require.{0,15}approv/i, /pending approv/i, /\bapprovals?\b/i],
    handler: async (organizationId) => {
      const { evaluations: pendingApprovals, total } = await listPolicyEvaluations(organizationId, {
        decision: "REQUIRE_APPROVAL",
        page: 1,
      });
      const { total: pendingCount } = await listApprovalRequests(organizationId, { status: "PENDING", page: 1 });
      if (total === 0) {
        return { intent: "approval_required", summary: "No actions have required approval.", evidence: [] };
      }
      return {
        intent: "approval_required",
        summary: `${total} action${total === 1 ? " has" : "s have"} required approval; ${pendingCount} currently pending review.`,
        evidence: pendingApprovals.slice(0, 5).map((e) => ({
          type: "policy_evaluation" as const,
          label: `${e.agent.name} — ${e.action}`,
          detail: e.reason,
          href: `/policies/evaluations/${e.id}`,
          timestamp: e.createdAt,
        })),
      };
    },
  },
  {
    id: "highest_risk_agent",
    patterns: [/highest.risk|riskiest|most risky|most dangerous/i],
    handler: async (organizationId) => {
      const [top] = await getHighRiskAgentsSummary(organizationId, 1);
      if (!top) {
        return { intent: "highest_risk_agent", summary: "No agent currently has open high or critical security alerts.", evidence: [] };
      }
      return {
        intent: "highest_risk_agent",
        summary: `${top.agent.name} is the highest-risk agent: ${top.highOrCriticalAlertCount} open high/critical alert${top.highOrCriticalAlertCount === 1 ? "" : "s"}${top.criticalAlertCount > 0 ? ` (${top.criticalAlertCount} critical)` : ""}.`,
        evidence: [{ type: "agent", label: top.agent.name, href: `/agents/${top.agent.slug}` }],
      };
    },
  },
  {
    id: "abnormal_agent",
    patterns: [/abnormal|unusual|behaving (strange|odd|weird)/i],
    handler: async (organizationId) => {
      const anomalies = await listRecentAnomalies(organizationId, 5);
      if (anomalies.length === 0) {
        return { intent: "abnormal_agent", summary: "No unusual behavior has been detected recently.", evidence: [] };
      }
      return {
        intent: "abnormal_agent",
        summary: `${anomalies[0]!.agent.name} has the most recent detected anomaly: "${anomalies[0]!.title}".`,
        evidence: anomalies.map((a) => ({
          type: "security_alert" as const,
          label: `${a.agent.name} — ${a.title}`,
          href: `/security/${a.id}`,
          timestamp: a.lastSeenAt,
        })),
      };
    },
  },
  {
    id: "cost_increase",
    patterns: [/costs?.{0,20}(increase|went up|higher|rising|spike)/i, /why.{0,15}(costs?|spend|spending)/i],
    handler: async (organizationId) => {
      const [summary, byAgent, spikes] = await Promise.all([
        getSpendSummary(organizationId),
        getSpendByAgent(organizationId),
        listSecurityAlertsByType(organizationId, SECURITY_ALERT_TYPES.COST_SPIKE, 5),
      ]);
      if (summary.changePercent === null) {
        return {
          intent: "cost_increase",
          summary: `Spend this month is ${formatCurrency(summary.thisMonthCents)}. There's no prior-month spend to compare against yet.`,
          evidence: [],
        };
      }
      const direction = summary.changePercent > 0 ? "increased" : "decreased";
      const topAgent = byAgent[0];
      return {
        intent: "cost_increase",
        summary: `Spend has ${direction} ${Math.abs(Math.round(summary.changePercent))}% vs. last month (${formatCurrency(summary.thisMonthCents)} so far).${
          topAgent ? ` ${topAgent.agentName} is the largest contributor at ${formatCurrency(topAgent.spendCents)}.` : ""
        }${spikes.length > 0 ? ` ${spikes.length} cost-spike alert${spikes.length === 1 ? "" : "s"} detected.` : ""}`,
        evidence: [
          ...(topAgent ? [{ type: "agent" as const, label: topAgent.agentName, href: `/agents/${topAgent.agentSlug}` }] : []),
          ...spikes.map((s) => ({
            type: "security_alert" as const,
            label: `${s.title}`,
            href: `/security/${s.id}`,
            timestamp: s.lastSeenAt,
          })),
        ],
      };
    },
  },
  {
    id: "sensitive_data_access",
    patterns: [/(accessed?|access|touched).{0,20}(customer|sensitive|data)/i, /sensitive data/i],
    handler: async (organizationId) => {
      const { events, total } = await listActivityEvents(organizationId, {
        eventType: "DATA_ACCESS",
        range: "7d",
        page: 1,
      });
      if (total === 0) {
        return {
          intent: "sensitive_data_access",
          summary: "No agent has accessed data classified as DATA_ACCESS in the last 7 days.",
          evidence: [],
        };
      }
      const agentNames = [...new Set(events.map((e) => e.agent.name))];
      return {
        intent: "sensitive_data_access",
        summary: `${agentNames.length} agent${agentNames.length === 1 ? "" : "s"} accessed data in the last 7 days: ${agentNames.slice(0, 5).join(", ")}. ${total} event${total === 1 ? "" : "s"} total.`,
        evidence: events.slice(0, 5).map(activityEvidence),
      };
    },
  },
  {
    id: "external_requests",
    patterns: [/external.{0,15}(request|communication|api call)/i, /sent.{0,10}(email|message)/i],
    handler: async (organizationId) => {
      const { events, total } = await listActivityEvents(organizationId, {
        eventType: "COMMUNICATION",
        range: "7d",
        page: 1,
      });
      if (total === 0) {
        return {
          intent: "external_requests",
          summary: "No agent has sent external communication in the last 7 days.",
          evidence: [],
        };
      }
      const agentNames = [...new Set(events.map((e) => e.agent.name))];
      return {
        intent: "external_requests",
        summary: `${agentNames.length} agent${agentNames.length === 1 ? "" : "s"} sent external communication in the last 7 days: ${agentNames.slice(0, 5).join(", ")}.`,
        evidence: events.slice(0, 5).map(activityEvidence),
      };
    },
  },
  {
    id: "recent_failures",
    patterns: [/before.{0,10}(this )?failure/i, /\bfailures?\b/i, /what happened before/i],
    handler: async (organizationId) => {
      const { events, total } = await listActivityEvents(organizationId, { status: "FAILED", range: "7d", page: 1 });
      if (total === 0) {
        return { intent: "recent_failures", summary: "No failed actions in the last 7 days.", evidence: [] };
      }
      return {
        intent: "recent_failures",
        summary: `${total} failed action${total === 1 ? "" : "s"} in the last 7 days. Most recent: "${events[0]!.action}" by ${events[0]!.agent.name} at ${formatDateTime(events[0]!.timestamp)}.`,
        evidence: events.slice(0, 5).map(activityEvidence),
      };
    },
  },
  {
    id: "recent_activity",
    patterns: [/what.{0,15}(agents?|they).{0,15}(do|doing|did)/i, /activity today/i, /what happened today/i],
    handler: async (organizationId) => {
      const { events, total } = await listActivityEvents(organizationId, { range: "24h", page: 1 });
      if (total === 0) {
        return { intent: "recent_activity", summary: "No activity recorded in the last 24 hours.", evidence: [] };
      }
      return {
        intent: "recent_activity",
        summary: `${total} action${total === 1 ? "" : "s"} across your agents in the last 24 hours.`,
        evidence: events.slice(0, 5).map(activityEvidence),
      };
    },
  },
];

/**
 * Matches the question against every known intent, in order (most
 * specific first) and returns the first match's answer. No match returns
 * the honest "not enough evidence" fallback rather than guessing.
 */
export async function answerQuestion(organizationId: string, question: string): Promise<AskAnswer> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return { intent: "none", summary: NO_EVIDENCE_ANSWER, evidence: [] };
  }

  for (const intent of INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(trimmed))) {
      return intent.handler(organizationId);
    }
  }

  return { intent: "none", summary: NO_EVIDENCE_ANSWER, evidence: [] };
}
