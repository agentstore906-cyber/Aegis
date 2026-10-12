import "server-only";

import { prisma } from "@/lib/db";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { normalizeKey } from "@/lib/telemetry/normalize";

/**
 * "Has this agent done this before?" for the first-time detectors (new sensitive action, new tool / namespace).
 *
 * Raw `activity_events` are not enough on their own: plan retention (lib/retention/activity.ts) deletes them, so an
 * action last seen past the plan window would look brand new and re-fire a "first time" alert. History is therefore the
 * union of three independent records, none of which is created by this feature:
 *  1. raw events still retained (the current event is already stored, hence "more than one" for exact counts);
 *  2. hourly behavior rollups (`agent_activity_rollups`, kept ROLLUP_RETENTION_DAYS, survive event purges);
 *  3. a previous alert of the SAME type and dedupe key — alerts are evidence, never purged by retention, and the
 *     first-time detectors always raise one the first time, so this is a durable "seen" marker with no new schema.
 *
 * Every query is tenant- and agent-scoped. A genuinely first-time action has none of the three and still alerts.
 */

type Scope = { organizationId: string; agentId: string };

const hasRollup = async (scope: Scope, dimension: "action" | "tool", key: string | { startsWith: string }) =>
  (await prisma.agentActivityRollup.findFirst({ where: { ...scope, dimension, key }, select: { agentId: true } })) !== null;

const hasAlert = async (scope: Scope, type: string, dedupeKey: string) =>
  (await prisma.securityAlert.findFirst({ where: { ...scope, type, dedupeKey }, select: { id: true } })) !== null;

export function namespaceOf(action: string): { namespace: string; dotted: boolean } {
  const dotIndex = action.indexOf(".");
  return dotIndex === -1 ? { namespace: action, dotted: false } : { namespace: action.slice(0, dotIndex), dotted: true };
}

export async function hasPriorActionHistory(scope: Scope, action: string): Promise<boolean> {
  const [events, rollup, alert] = await Promise.all([
    prisma.activityEvent.count({ where: { ...scope, action } }),
    hasRollup(scope, "action", action),
    hasAlert(scope, SECURITY_ALERT_TYPES.NEW_SENSITIVE_ACTION, `action:${action}`),
  ]);
  return events > 1 || rollup || alert;
}

export async function hasPriorNamespaceHistory(scope: Scope, action: string): Promise<boolean> {
  const { namespace, dotted } = namespaceOf(action);
  const [events, rollup, alert] = await Promise.all([
    prisma.activityEvent.count({ where: { ...scope, action: dotted ? { startsWith: `${namespace}.` } : namespace } }),
    hasRollup(scope, "action", dotted ? { startsWith: `${namespace}.` } : namespace),
    hasAlert(scope, SECURITY_ALERT_TYPES.NEW_TOOL_USAGE, `namespace:${namespace}`),
  ]);
  return events > 1 || rollup || alert;
}

export async function hasPriorToolHistory(scope: Scope, toolName: string | null | undefined): Promise<boolean> {
  const toolKey = normalizeKey(toolName);
  if (!toolKey || !toolName) return false;
  const [events, rollup, alert] = await Promise.all([
    prisma.activityEvent.count({ where: { ...scope, toolKey } }),
    hasRollup(scope, "tool", toolKey),
    hasAlert(scope, SECURITY_ALERT_TYPES.NEW_TOOL_USAGE, `tool:${toolKey}`),
  ]);
  return events > 1 || rollup || alert;
}
