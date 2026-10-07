import type { PolicyDecision } from "@prisma/client";

import type { AgentManifest } from "@/lib/connectors/endpoint-protocol";

/**
 * Pure model of an agent security scan: who may be scanned, and which findings follow from which evidence.
 * No database, no score. Every finding names the observation or probe behind it, and says whether it was
 * OBSERVED (read from what the real agent did / how it is configured in Aegis) or TESTED (what Aegis's own
 * policies returned to a read-only probe). Nothing here describes the agent's prompts or code: Aegis does not see them.
 */

export type ScanBlockCode = "NOT_FOUND" | "NOT_CONNECTED" | "NOT_REACHABLE";

export class AgentNotScannableError extends Error {
  constructor(
    readonly code: ScanBlockCode,
    message: string
  ) {
    super(message);
    this.name = "AgentNotScannableError";
  }
}

/**
 * Only an agent Aegis CONNECTED TO and verified (aegis-agent/1) can be scanned. A record that was never verified, a
 * disconnected or errored connection, or an agent connected some other way is refused — Aegis would have nothing real
 * to scan. (A connection last verified more than a day ago is allowed to proceed: the scan itself re-verifies the agent
 * live and stops if it cannot.)
 */
export function scanEligibility(input: { state: string; connectorType: string | null; firstHandshakeAt: Date | string | null }): { ok: true } | { ok: false; code: ScanBlockCode; message: string } {
  const notConnected = (message: string) => ({ ok: false as const, code: "NOT_CONNECTED" as const, message });
  if (input.connectorType !== "AEGIS_ENDPOINT") {
    return notConnected("Connect an AI agent first. Aegis scans an agent it has connected to and verified through its endpoint.");
  }
  if (input.state === "REVOKED") return notConnected("This agent is disconnected. Reconnect it to scan.");
  if (input.state === "ERROR") return notConnected("The connection to this agent has a problem. Check the connection, then scan.");
  if ((input.state === "CONNECTED" || input.state === "NOT_SEEN_RECENTLY") && input.firstHandshakeAt) return { ok: true };
  return notConnected("Connect an AI agent first.");
}

export type ProbeResult = {
  action: string;
  label: string;
  critical: boolean;
  /** Null = the probe could not be answered (never counted as a pass). */
  decision: PolicyDecision | null;
  decisionSource: string | null;
  reason: string;
};

export type ScanEvidence = {
  connection: { firstHandshakeAt: Date | null; lastSeenAt: Date | null };
  identity: { assurance: "ISOLATED" | "BOUND_SHARED" | "ORG_WIDE_ONLY" | "NO_KEY"; boundKeys: number; orgWideKeys: number };
  access: { allow: number; alert: number; requireApproval: number; block: number; total: number; broadGrants: number };
  coverage: { reportedActions: number; decided: number; undecided: number; ranDespite: number; decisionRequests: number; coverage: number | null; windowDays: number };
  activityEvents7d: number;
  deviations7d: number;
  openIncidents: number;
  pendingApprovals: number;
  unusedGrants: number;
  activePolicies: number;
  keysWithoutExpiry: number;
  openAlerts: Record<string, number>;
};

export type ScanObservation = { id: string; kind: "fact" | "limitation"; label: string; value: string };
export type ScanFinding = {
  id: string;
  severity: "high" | "medium" | "low" | "info";
  basis: "observed" | "tested";
  title: string;
  detail: string;
  /** Ids of the observations / probes (`test:<action>`) this finding rests on. */
  evidence: string[];
};
/** A read-only check made against the agent's own endpoint. "not_tested" means Aegis could not make the check; it is never shown as passed. */
export type EndpointTestResult = {
  id: "transport_tls" | "unsigned_rejected" | "wrong_signature_rejected" | "stale_request_rejected";
  label: string;
  outcome: "passed" | "failed" | "not_tested";
  detail: string;
};
export type NotTestedItem = { id: string; label: string; reason: string };

export type EndpointEvidence = {
  endpointHost: string;
  usesTls: boolean;
  agentName: string;
  manifest: AgentManifest | null;
  probes: { unsigned: ProbeOutcome; wrongSignature: ProbeOutcome; stale: ProbeOutcome };
};
type ProbeOutcome = { outcome: "rejected" | "accepted" | "inconclusive"; status: number | null; detail: string };

export type AgentScanResult = {
  observations: ScanObservation[];
  /** Aegis's own policies, asked what they would return (read-only simulation). */
  tests: ProbeResult[];
  /** Checks made against the agent's endpoint. */
  endpointTests: EndpointTestResult[];
  /** What Aegis could not or did not check, and why. Never presented as passed. */
  notTested: NotTestedItem[];
  findings: ScanFinding[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildAgentScan(e: ScanEvidence, probes: ProbeResult[], endpoint: EndpointEvidence): AgentScanResult {
  const fact = (id: string, label: string, value: string): ScanObservation => ({ id, kind: "fact", label, value });
  const openAlertTotal = Object.values(e.openAlerts).reduce((a, b) => a + b, 0);
  const highAlerts = (e.openAlerts.HIGH ?? 0) + (e.openAlerts.CRITICAL ?? 0);

  const observations: ScanObservation[] = [
    fact("connection", "Contact", e.connection.firstHandshakeAt ? `First contact ${e.connection.firstHandshakeAt.toISOString()}${e.connection.lastSeenAt ? `, last seen ${e.connection.lastSeenAt.toISOString()}` : ""}` : "No contact recorded"),
    fact("identity", "Credential", { ISOLATED: "A credential bound to this agent only", BOUND_SHARED: "A credential bound to this agent, and organization-wide keys also exist", ORG_WIDE_ONLY: "Only organization-wide keys exist (no credential identifies this agent alone)", NO_KEY: "No active credential" }[e.identity.assurance]),
    fact("grants", "Permissions", `${e.access.allow} allow, ${e.access.alert} alert, ${e.access.requireApproval} require approval, ${e.access.block} block (${e.access.broadGrants} broad)`),
    fact("policies", "Active policies", String(e.activePolicies)),
    fact("activity", "Reported actions, last 7 days", String(e.activityEvents7d)),
    fact("decisions", `Decisions requested, last ${e.coverage.windowDays} days`, String(e.coverage.decisionRequests)),
    fact("alerts", "Open security alerts", String(openAlertTotal)),
    fact("incidents", "Open incidents", String(e.openIncidents)),
    fact("deviations", "Unusual behavior, last 7 days", String(e.deviations7d)),
  ];
  observations.unshift(
    fact("endpoint", "Agent endpoint", `${endpoint.endpointHost} (${endpoint.usesTls ? "HTTPS" : "not HTTPS"})`),
    fact("verified", "Verified just now", `Aegis connected to "${endpoint.agentName}", and it proved it holds the shared secret and is the agent connected before`),
    ...(endpoint.manifest
      ? [
          fact("declared", "Declared by the agent", [endpoint.manifest.framework, endpoint.manifest.model].filter(Boolean).join(" · ") || "no framework or model declared"),
          fact("declared-tools", "Declared tools", endpoint.manifest.tools.length ? endpoint.manifest.tools.map((t) => `${t.name}${t.access ? ` (${t.access})` : ""}`).join(", ") : "none declared"),
        ]
      : []),
  );
  const limitations: ScanObservation[] = [
    { id: "limit:scope", kind: "limitation", label: "What was not tested", value: "Aegis does not test the agent's prompts, source code or model behavior. Nothing was executed on the agent. Aegis contacted only the agent's Aegis endpoint, read-only." },
  ];
  if (e.activityEvents7d === 0) {
    limitations.push({ id: "limit:no-activity", kind: "limitation", label: "No recent activity", value: "The agent reported no actions in the last 7 days, so nothing about its behavior could be observed." });
  }

  const findings: ScanFinding[] = [];

  // TESTED: sensitive actions Aegis would let through unattended.
  const open = probes.filter((p) => p.decision === "ALLOW" || p.decision === "ALERT");
  if (open.length > 0) {
    const critical = open.some((p) => p.critical);
    findings.push({
      id: "sensitive-actions-not-gated",
      severity: critical ? "high" : "medium",
      basis: "tested",
      title: "Sensitive actions would be allowed without approval",
      detail: `If this agent asked, Aegis would return ${[...new Set(open.map((p) => p.decision))].join("/")} for: ${open.map((p) => `${p.label} (${p.action})`).join("; ")}. Add a policy that requires approval or blocks them.`,
      evidence: open.map((p) => `test:${p.action}`),
    });
  }
  const unanswered = probes.filter((p) => p.decision === null);
  if (unanswered.length > 0) {
    findings.push({
      id: "probes-unanswered",
      severity: "info",
      basis: "tested",
      title: "Some tests could not be answered",
      detail: `Aegis could not evaluate: ${unanswered.map((p) => p.action).join(", ")}. They are not counted as passed.`,
      evidence: unanswered.map((p) => `test:${p.action}`),
    });
  }

  // OBSERVED findings.
  if (e.coverage.ranDespite > 0) {
    findings.push({
      id: "ran-despite-decision",
      severity: "high",
      basis: "observed",
      title: "The agent ran actions after Aegis told it not to",
      detail: `${plural(e.coverage.ranDespite, "reported action")} completed after Aegis returned BLOCK or REQUIRE_APPROVAL (last ${e.coverage.windowDays} days). Aegis returns decisions; the agent's integration must honor them.`,
      evidence: ["decisions"],
    });
  }
  if (highAlerts > 0) {
    findings.push({
      id: "open-high-alerts",
      severity: "high",
      basis: "observed",
      title: `${plural(highAlerts, "high-severity security alert")} open`,
      detail: "Review them under this agent's Security tab.",
      evidence: ["alerts"],
    });
  }
  if (e.activityEvents7d > 0 && e.coverage.decisionRequests === 0) {
    findings.push({
      id: "never-asks-aegis",
      severity: "medium",
      basis: "observed",
      title: "The agent reports activity but never asks Aegis for a decision",
      detail: "Aegis can see what it did, but cannot return allow/approval/block decisions it is never asked for. Have the agent ask before acting (the SDK's guard does this).",
      evidence: ["activity", "decisions"],
    });
  } else if (e.coverage.coverage !== null && e.coverage.coverage < 0.5 && e.coverage.decisionRequests > 0) {
    findings.push({
      id: "low-decision-coverage",
      severity: "medium",
      basis: "observed",
      title: "Most reported actions never went through an Aegis decision",
      detail: `${e.coverage.decided} of ${e.coverage.reportedActions} reported actions were decided by Aegis (last ${e.coverage.windowDays} days).`,
      evidence: ["activity", "decisions"],
    });
  }
  if (e.identity.assurance === "ORG_WIDE_ONLY" && e.activityEvents7d > 0) {
    findings.push({
      id: "shared-key-identity",
      severity: "medium",
      basis: "observed",
      title: "This agent's identity is only a shared key",
      detail: "It reports activity, but no credential identifies this agent alone. Issue a credential bound to this agent.",
      evidence: ["identity"],
    });
  }
  if (e.access.broadGrants > 0) {
    findings.push({
      id: "broad-grants",
      severity: "medium",
      basis: "observed",
      title: `${plural(e.access.broadGrants, "broad permission")} granted`,
      detail: "An ALLOW over a whole action namespace for any resource. Narrow it to the actions the agent needs.",
      evidence: ["grants"],
    });
  }
  if (e.deviations7d > 0) {
    findings.push({
      id: "unusual-behavior",
      severity: "medium",
      basis: "observed",
      title: "Behavior differing from this agent's own history",
      detail: `${plural(e.deviations7d, "deviation")} recorded in the last 7 days. See the Behavior tab.`,
      evidence: ["deviations"],
    });
  }
  if (e.unusedGrants > 0) {
    findings.push({
      id: "unused-grants",
      severity: "low",
      basis: "observed",
      title: `${plural(e.unusedGrants, "permission")} with no evidence of use`,
      detail: "Granted, but matching nothing the agent did in the last 30 days.",
      evidence: ["grants"],
    });
  }
  if (e.keysWithoutExpiry > 0) {
    findings.push({
      id: "keys-without-expiry",
      severity: "low",
      basis: "observed",
      title: `${plural(e.keysWithoutExpiry, "credential")} for this agent never expire`,
      detail: "Consider an expiry and rotation for long-lived credentials.",
      evidence: ["identity"],
    });
  }
  if (e.access.total === 0 && e.activePolicies === 0) {
    findings.push({
      id: "nothing-granted",
      severity: "info",
      basis: "observed",
      title: "No permission or policy allows anything for this agent",
      detail: "Aegis denies by default, so decisions it is asked for will be refused until something is allowed.",
      evidence: ["grants", "policies"],
    });
  }

  // ENDPOINT TESTS — made against the agent itself, read-only.
  const probeTest = (id: EndpointTestResult["id"], label: string, p: ProbeOutcome, rejectedText: string, acceptedText: string): EndpointTestResult =>
    p.outcome === "rejected"
      ? { id, label, outcome: "passed", detail: rejectedText }
      : p.outcome === "accepted"
        ? { id, label, outcome: "failed", detail: acceptedText }
        : { id, label, outcome: "not_tested", detail: `Could not be judged: ${p.detail}.` };
  const endpointTests: EndpointTestResult[] = [
    endpoint.usesTls
      ? { id: "transport_tls", label: "Connection is encrypted", outcome: "passed", detail: "The endpoint is served over HTTPS and its certificate was verified." }
      : { id: "transport_tls", label: "Connection is encrypted", outcome: "failed", detail: "The endpoint is not served over HTTPS." },
    probeTest("unsigned_rejected", "Refuses a request with no signature", endpoint.probes.unsigned, "The agent refused it.", "The agent answered a request that carried no signature."),
    probeTest("wrong_signature_rejected", "Refuses a request with a wrong signature", endpoint.probes.wrongSignature, "The agent refused it.", "The agent answered a request signed with the wrong secret."),
    probeTest("stale_request_rejected", "Refuses an old signed request", endpoint.probes.stale, "The agent refused a correctly signed request that was an hour old.", "The agent answered a correctly signed request that was an hour old (replayable)."),
  ];
  const failed = (id: EndpointTestResult["id"]) => endpointTests.find((t) => t.id === id)?.outcome === "failed";
  if (failed("unsigned_rejected")) {
    findings.push({ id: "endpoint-accepts-unsigned", severity: "high", basis: "tested", title: "The agent's Aegis endpoint answers unauthenticated requests", detail: "Anyone who can reach the endpoint can get an answer without the shared secret. Require a valid signature on every request.", evidence: ["test:unsigned_rejected"] });
  }
  if (failed("wrong_signature_rejected")) {
    findings.push({ id: "endpoint-accepts-wrong-signature", severity: "high", basis: "tested", title: "The agent's Aegis endpoint accepts a wrong signature", detail: "The agent answered a request signed with a different secret, so the signature is not actually checked.", evidence: ["test:wrong_signature_rejected"] });
  }
  if (failed("stale_request_rejected")) {
    findings.push({ id: "endpoint-accepts-replay", severity: "medium", basis: "tested", title: "The agent accepts old signed requests", detail: "A captured signed request could be replayed. Reject requests whose timestamp is more than five minutes from the agent's clock.", evidence: ["test:stale_request_rejected"] });
  }
  if (failed("transport_tls")) {
    findings.push({ id: "endpoint-not-https", severity: "medium", basis: "tested", title: "The agent's endpoint is not served over HTTPS", detail: "Requests and answers can be read or altered in transit. Serve the endpoint over HTTPS.", evidence: ["test:transport_tls"] });
  }

  // DECLARED BY THE AGENT — observed, but only as truthful as the agent's own manifest.
  const notTested: NotTestedItem[] = [];
  if (endpoint.manifest) {
    const destructive = endpoint.manifest.tools.filter((t) => t.access === "destructive");
    if (destructive.length > 0) {
      findings.push({
        id: "declared-destructive-tools",
        severity: endpoint.manifest.humanApproval === true ? "low" : "medium",
        basis: "observed",
        title: `${plural(destructive.length, "tool")} declared destructive`,
        detail: `The agent declares: ${destructive.map((t) => t.name).join(", ")}. ${endpoint.manifest.humanApproval === true ? "It declares human approval for risky actions." : "It does not declare human approval for them."} This is what the agent says about itself; Aegis did not run these tools.`,
        evidence: ["declared-tools"],
      });
    }
    const unrated = endpoint.manifest.tools.filter((t) => t.access === null);
    if (unrated.length > 0) {
      notTested.push({ id: "tool-access-levels", label: `Access level of ${plural(unrated.length, "declared tool")}`, reason: `The agent did not declare whether ${unrated.map((t) => t.name).join(", ")} read, write or destroy, so Aegis cannot assess them.` });
    }
  } else {
    notTested.push({ id: "declared-tools", label: "Declared tools and approval gates", reason: "The agent's endpoint did not provide a manifest, so nothing about its tools could be observed." });
  }
  for (const t of endpointTests.filter((x) => x.outcome === "not_tested")) {
    notTested.push({ id: `endpoint:${t.id}`, label: t.label, reason: t.detail });
  }
  notTested.push(
    { id: "prompts", label: "Prompts and instructions", reason: "Aegis has no read-only interface to the agent's prompts, and does not send the agent any content." },
    { id: "source-code", label: "Source code and dependencies", reason: "Aegis does not have access to the agent's code." },
    { id: "model-behavior", label: "Model behavior (for example prompt-injection resistance)", reason: "Testing it would mean sending the agent adversarial input; this scan is read-only and never does." },
    { id: "tool-execution", label: "What the agent's tools do when run", reason: "No tool is executed during a scan." },
  );

  const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { observations: [...observations, ...limitations], tests: probes, endpointTests, notTested, findings };
}
