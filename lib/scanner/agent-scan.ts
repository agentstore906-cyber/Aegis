import "server-only";

import type { PolicyDecision } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { readConnectionSecret } from "@/lib/agents/connection-service";
import { getAgentControlView } from "@/lib/control/agent-view";
import { simulateAgentAction } from "@/lib/control/simulate";
import { contactAgent, EndpointError, probeEndpoint } from "@/lib/connectors/endpoint-client";
import {
  AgentNotScannableError,
  buildAgentScan,
  scanEligibility,
  type AgentScanResult,
  type ProbeResult,
  type ScanEvidence,
} from "@/lib/scanner/agent-scan-model";

export { AgentNotScannableError } from "@/lib/scanner/agent-scan-model";
export type { AgentScanResult } from "@/lib/scanner/agent-scan-model";

/**
 * Security scan of ONE real external agent that Aegis connected to (aegis-agent/1).
 *
 * The agent is named by slug but resolved inside the caller's organization, and what is scanned is the agent behind
 * that record's stored, pinned connection — never the endpoint or an id the caller supplies. The scan:
 *   1. refuses unless the agent was connected through its endpoint (a name or a database row is not an agent);
 *   2. re-verifies the agent LIVE with a fresh signed challenge and stops if it cannot be reached, if it no longer
 *      proves the shared secret, or if a different agent now answers at the endpoint;
 *   3. reads the agent's declared manifest (read-only `describe`);
 *   4. sends three read-only probes to the endpoint that a correct agent must refuse (no signature, wrong signature,
 *      a validly signed request an hour old) — none carries real credentials and none has a side effect;
 *   5. reads what Aegis itself recorded about the agent and asks Aegis's own policies (read-only simulation) how they
 *      would answer sensitive requests.
 * It never executes a tool, sends the agent a prompt or any content, or contacts anything but the stored endpoint.
 * Whatever it could not check is returned as "not tested".
 */

/** Sensitive actions Aegis asks its own policies about. Names are conventional action strings, not claims about this agent. */
export const PROBES: { action: string; tool: string; label: string; critical: boolean }[] = [
  { action: "shell.exec", tool: "shell", label: "run shell commands", critical: true },
  { action: "payments.transfer", tool: "payments", label: "move money", critical: true },
  { action: "secrets.read", tool: "secrets", label: "read secrets", critical: true },
  { action: "database.delete", tool: "database", label: "delete database records", critical: true },
  { action: "files.delete", tool: "files", label: "delete files", critical: false },
  { action: "email.send_external", tool: "email", label: "send email to outside recipients", critical: false },
  { action: "customer_data.export", tool: "crm", label: "export customer data", critical: false },
  { action: "code.deploy", tool: "deploy", label: "deploy code", critical: false },
];

export async function runAgentScan(params: { organizationId: string; agentSlug: string; userId: string | null; now?: Date }): Promise<{ id: string; result: AgentScanResult }> {
  const now = params.now ?? new Date();
  const [snapshot, control] = await Promise.all([
    getAgentConnectionSnapshot(params.organizationId, params.agentSlug, now),
    getAgentControlView(params.organizationId, params.agentSlug, now),
  ]);
  if (!snapshot || !control) throw new AgentNotScannableError("NOT_FOUND", "Agent not found.");

  const eligibility = scanEligibility({ state: snapshot.view.state, connectorType: snapshot.connectorType, firstHandshakeAt: snapshot.view.firstHandshakeAt });
  if (!eligibility.ok) {
    // The reason the backend recorded (for example, a different agent now answers at the endpoint) says more than the generic line.
    const why = snapshot.view.state === "ERROR" && snapshot.view.reason ? ` ${snapshot.view.reason}` : "";
    throw new AgentNotScannableError(eligibility.code, `${eligibility.message}${why}`);
  }

  const agent = control.agent;
  const connection = await prisma.agentConnection.findFirst({
    where: { organizationId: params.organizationId, agentId: agent.id, connectorType: "AEGIS_ENDPOINT" },
  });
  if (!connection?.endpointUrl || !connection.externalAgentId) throw new AgentNotScannableError("NOT_CONNECTED", "Connect an AI agent first.");

  // 2. The live verification. No contact, no scan.
  let secret: string | undefined;
  try {
    secret = await readConnectionSecret(connection);
  } catch {
    secret = undefined;
  }
  if (!secret) throw new AgentNotScannableError("NOT_REACHABLE", "Aegis can no longer read this connection's shared secret. Reconnect the agent.");

  const markUnhealthy = (message: string) =>
    prisma.agentConnection.update({ where: { id: connection.id }, data: { status: "RECONNECT_REQUIRED", lastHealthCheckAt: new Date(), lastHealthError: message } }).catch(() => undefined);

  let live;
  try {
    live = await contactAgent(connection.endpointUrl, secret, "describe");
  } catch (error) {
    const message = error instanceof EndpointError ? error.message : "Aegis could not verify the agent.";
    await markUnhealthy(message);
    throw new AgentNotScannableError("NOT_REACHABLE", `Aegis could not verify this agent right now, so it was not scanned. ${message}`);
  }
  if (live.id !== connection.externalAgentId) {
    const message = "A different agent now answers at this endpoint. Aegis will not scan it as the agent connected before.";
    await markUnhealthy(message);
    throw new AgentNotScannableError("NOT_REACHABLE", message);
  }
  const verifiedAt = new Date();
  await prisma.agentConnection.update({
    where: { id: connection.id },
    data: { status: "CONNECTED", lastVerifiedAt: verifiedAt, lastSeenAt: verifiedAt, lastHealthCheckAt: verifiedAt, lastHealthError: null },
  });

  // 4 + 5. Read-only probes of the endpoint, Aegis's own evidence, and policy simulations.
  const [unsigned, wrongSignature, stale, alerts, probes] = await Promise.all([
    probeEndpoint(connection.endpointUrl, secret, "unsigned"),
    probeEndpoint(connection.endpointUrl, secret, "wrong_signature"),
    probeEndpoint(connection.endpointUrl, secret, "stale_timestamp"),
    prisma.securityAlert.groupBy({
      by: ["severity"],
      where: { organizationId: params.organizationId, agentId: agent.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      _count: true,
    }),
    Promise.all(
      PROBES.map(async (p): Promise<ProbeResult> => {
        try {
          const sim = await simulateAgentAction({ organizationId: params.organizationId, agentId: agent.id, action: p.action, tool: p.tool });
          return { action: p.action, label: p.label, critical: p.critical, decision: sim.decision as PolicyDecision, decisionSource: sim.decisionSource, reason: sim.reason };
        } catch {
          // A probe that cannot be answered is reported as such — never as a pass.
          return { action: p.action, label: p.label, critical: p.critical, decision: null, decisionSource: null, reason: "Aegis could not answer this probe." };
        }
      })
    ),
  ]);

  const evidence: ScanEvidence = {
    connection: { firstHandshakeAt: connection.firstHandshakeAt, lastSeenAt: verifiedAt },
    identity: agent.identity,
    access: agent.access,
    coverage: agent.coverage,
    activityEvents7d: agent.activityEvents7d,
    deviations7d: agent.deviations7d,
    openIncidents: agent.openIncidents,
    pendingApprovals: agent.pendingApprovals,
    unusedGrants: control.review.unusedGrants.length,
    activePolicies: control.policies.length,
    keysWithoutExpiry: control.keys.filter((k) => k.expiresAt === null).length,
    openAlerts: Object.fromEntries(alerts.map((a) => [a.severity, a._count])),
  };
  const url = new URL(connection.endpointUrl);
  const result = buildAgentScan(evidence, probes, {
    endpointHost: url.host,
    usesTls: url.protocol === "https:",
    agentName: live.name,
    manifest: live.manifest,
    probes: { unsigned, wrongSignature, stale },
  });

  const row = await prisma.agentSecurityScan.create({
    data: {
      organizationId: params.organizationId,
      agentId: agent.id,
      startedById: params.userId,
      firstHandshakeAt: connection.firstHandshakeAt,
      lastSeenAt: verifiedAt,
      observations: JSON.parse(JSON.stringify(result.observations)),
      tests: JSON.parse(JSON.stringify(result.tests)),
      endpointTests: JSON.parse(JSON.stringify(result.endpointTests)),
      notTested: JSON.parse(JSON.stringify(result.notTested)),
      findings: JSON.parse(JSON.stringify(result.findings)),
      findingCount: result.findings.length,
    },
    select: { id: true },
  });
  return { id: row.id, result };
}

export type StoredAgentScan = { id: string; createdAt: Date; result: AgentScanResult };

/** Latest scan of this agent, only if the agent belongs to the organization. */
export async function getLatestAgentScan(organizationId: string, agentId: string): Promise<StoredAgentScan | null> {
  const row = await prisma.agentSecurityScan.findFirst({ where: { organizationId, agentId }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    result: {
      observations: row.observations as never,
      tests: row.tests as never,
      endpointTests: row.endpointTests as never,
      notTested: row.notTested as never,
      findings: row.findings as never,
    },
  };
}
