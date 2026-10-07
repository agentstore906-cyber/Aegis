import "server-only";

import { prisma } from "@/lib/db";
import { getAgentListSignals } from "@/lib/agents/list-signals";

/**
 * The agents the Free Risk Scanner may offer: agents of THIS organization that Aegis connected TO and verified
 * (aegis-agent/1). A record that was never verified, a disconnected or errored connection, and agents connected any
 * other way are never targets. A connection last verified over a day ago is still offered, labelled as such, because
 * the scan re-verifies the agent live and refuses if it cannot. Tenant-scoped on every query.
 */
export type ScanTarget = {
  id: string;
  slug: string;
  name: string;
  state: "CONNECTED" | "NOT_SEEN_RECENTLY";
  stateLabel: string;
  lastSeenAt: Date | null;
  lastScan: { at: Date; findingCount: number } | null;
};

export async function listScanTargets(organizationId: string, now = new Date()): Promise<{ targets: ScanTarget[]; notScannable: number }> {
  const [total, contacted] = await Promise.all([
    prisma.agent.count({ where: { organizationId, status: { not: "ARCHIVED" } } }),
    prisma.agent.findMany({
      where: { organizationId, status: { not: "ARCHIVED" }, connection: { is: { connectorType: "AEGIS_ENDPOINT", firstHandshakeAt: { not: null } } } },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, slug: true, name: true },
    }),
  ]);
  const signals = await getAgentListSignals(organizationId, contacted.map((a) => a.id), now);
  const scannable = (id: string) => {
    const state = signals.get(id)?.connection.state;
    return state === "CONNECTED" || state === "NOT_SEEN_RECENTLY";
  };
  const connected = contacted.filter((a) => scannable(a.id));

  const scans = connected.length
    ? await prisma.agentSecurityScan.findMany({
        where: { organizationId, agentId: { in: connected.map((a) => a.id) } },
        orderBy: { createdAt: "desc" },
        distinct: ["agentId"],
        select: { agentId: true, createdAt: true, findingCount: true },
      })
    : [];
  const lastScan = new Map(scans.map((s) => [s.agentId, { at: s.createdAt, findingCount: s.findingCount }]));

  const targets = connected.map((a): ScanTarget => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    state: signals.get(a.id)!.connection.state as "CONNECTED" | "NOT_SEEN_RECENTLY",
    stateLabel: signals.get(a.id)!.connection.label,
    lastSeenAt: signals.get(a.id)!.connection.lastSeenAt,
    lastScan: lastScan.get(a.id) ?? null,
  }));
  return { targets, notScannable: Math.max(total - targets.length, 0) };
}
