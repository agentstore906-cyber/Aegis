import {
  AGENT_TYPES,
  AGENT_TYPE_PROFILE,
  AUTONOMY_RANK,
  CAPABILITY_BY_ID,
  CAPABILITY_IDS,
  CONTROLS,
  CONTROL_CREDIT,
  CONTROL_STATE_LABEL,
  ENGINE_VERSION,
  type CapabilityId,
  type ControlId,
} from "@/lib/scanner/catalog";
import { AEGIS_MAPPING } from "@/lib/scanner/aegis-controls";
import { hasSecretLikeContent } from "@/lib/scanner/pasted";
import {
  DIMENSIONS,
  RISK_CATEGORIES,
  type Dimension,
  type Evidence,
  type Finding,
  type NotIndicatedArea,
  type PastedSignalSummary,
  type ProtectedArea,
  type RiskCategory,
  type RiskLevel,
  type ScanInput,
  type ScanResult,
  type Severity,
} from "@/lib/scanner/types";

/**
 * Deterministic, explainable risk engine. Same input → same output, always; no randomness, no clock,
 * no network, no model. See docs/AEGIS_FREE_RISK_SCANNER.md for the methodology this implements:
 *
 *   exposure (what the agent can reach/do)  →  inherent severity 1–4 per category
 *   × controls the user reported            →  mitigation m ∈ [0,1] (weighted credit per control)
 *   m ≥ 0.9 lowers severity three steps, m ≥ 0.7 two, m ≥ 0.4 one; a result below Low means "protected"
 *   residual severity → points → combined with diminishing returns into a 0–100 score.
 */

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"]; // index + 1 === numeric severity
const sevOf = (n: number): Severity => SEVERITIES[Math.min(4, Math.max(1, n)) - 1]!;

/** Points per residual finding. Combined as 100 × (1 − Π(1 − p/100)): each extra finding adds less. */
export const SEVERITY_POINTS: Record<Severity, number> = { critical: 35, high: 22, medium: 10, low: 4 };
export const LEVEL_THRESHOLDS = { moderate: 25, high: 50, critical: 75 } as const;
const BAR: Record<Severity, number> = { low: 25, medium: 50, high: 75, critical: 100 };

export const SCORE_DISCLAIMER =
  "This score is a transparent heuristic computed from the answers and text you provided. It indicates how elevated the risk of the described configuration may be. It is not a penetration test, a confirmed vulnerability, or a guarantee that your agent is or is not secure.";

export const LEVEL_LABEL: Record<RiskLevel, string> = { low: "Low", moderate: "Moderate", high: "High", critical: "Critical" };

const DIMENSION_LABEL: Record<Dimension, string> = {
  permissions: "Permissions",
  autonomy: "Autonomy",
  data: "Data access",
  execution: "Execution & injection",
  monitoring: "Monitoring",
  blast_radius: "Blast radius",
};

export const CATEGORY_TITLE: Record<RiskCategory, string> = {
  excessive_permissions: "Excessive permissions",
  unrestricted_tool_access: "Unrestricted tool access",
  autonomous_external_actions: "Autonomous external actions",
  sensitive_data_exposure: "Sensitive data exposure",
  code_execution_risk: "Code execution risk",
  prompt_injection_exposure: "Prompt injection exposure",
  missing_approval_gates: "Missing approval gates",
  missing_monitoring: "Missing monitoring",
  weak_secrets_isolation: "Weak secrets isolation",
  excessive_blast_radius: "Excessive blast radius",
};

const CATEGORY_DIMENSION: Record<RiskCategory, Dimension> = {
  excessive_permissions: "permissions",
  unrestricted_tool_access: "permissions",
  autonomous_external_actions: "autonomy",
  missing_approval_gates: "autonomy",
  sensitive_data_exposure: "data",
  weak_secrets_isolation: "data",
  code_execution_risk: "execution",
  prompt_injection_exposure: "execution",
  missing_monitoring: "monitoring",
  excessive_blast_radius: "blast_radius",
};

// ── Capability groupings the rules reason about ──────────────────────────────────────────────

const EXTERNAL_ACTIONS: CapabilityId[] = ["send_emails", "make_purchases", "create_accounts", "execute_transactions", "delete_data", "change_configurations"];
const SENSITIVE_DATA: CapabilityId[] = ["customer_data", "financial_data", "email", "databases", "private_documents"];
const OUTBOUND: CapabilityId[] = ["send_emails", "web_browsing", "apis", "code_execution", "shell", "cloud_services"];
const POWER_TOOLS: CapabilityId[] = ["code_execution", "shell", "cloud_services"];
const DESTRUCTIVE: CapabilityId[] = ["delete_data", "change_configurations", "execute_transactions", "make_purchases", "create_accounts"];

type Ctx = {
  input: ScanInput;
  caps: Set<CapabilityId>;
  observed: Set<CapabilityId>;
  inferred: Set<CapabilityId>;
  rank: number;
  pasted: PastedSignalSummary | null;
  /** Content-reading sources that an outsider could influence, with how we know. */
  untrusted: Evidence[];
};

const label = (id: CapabilityId) => CAPABILITY_BY_ID[id].label;
const labels = (ids: Iterable<CapabilityId>) => [...ids].map(label).join(", ");
const present = (ctx: Ctx, ids: CapabilityId[]) => ids.filter((id) => ctx.caps.has(id));
const ctrlLabel = (id: ControlId) => CONTROLS.find((c) => c.id === id)!.label;

function credit(ctx: Ctx, id: ControlId): number {
  const state = ctx.input.controls[id];
  return state ? CONTROL_CREDIT[state] : CONTROL_CREDIT.unsure;
}

/** Weighted mitigation m ∈ [0,1]. Weights are normalised, so they only express relative importance. */
function mitigation(ctx: Ctx, weights: Partial<Record<ControlId, number>>): number {
  let total = 0;
  let earned = 0;
  for (const [id, w] of Object.entries(weights) as [ControlId, number][]) {
    total += w;
    earned += w * credit(ctx, id);
  }
  return total === 0 ? 0 : earned / total;
}

function controlEvidence(ctx: Ctx, ids: ControlId[]): Evidence[] {
  return ids.map((id) => {
    const state = ctx.input.controls[id];
    if (!state || state === "unsure") return { kind: "observed" as const, text: `${ctrlLabel(id)}: not confirmed ("Not sure" or unanswered), so little credit is given` };
    return { kind: "observed" as const, text: `${ctrlLabel(id)}: ${CONTROL_STATE_LABEL[state].toLowerCase()}` };
  });
}

function capabilityEvidence(ctx: Ctx, ids: CapabilityId[]): Evidence[] {
  const out: Evidence[] = [];
  const obs = ids.filter((id) => ctx.observed.has(id));
  const inf = ids.filter((id) => ctx.inferred.has(id) && !ctx.observed.has(id));
  if (obs.length > 0) out.push({ kind: "observed", text: `You selected: ${labels(obs)}` });
  if (inf.length > 0) out.push({ kind: "inferred", text: `Your pasted content references: ${labels(inf)} (inferred; not in your answers)` });
  return out;
}

function autonomyEvidence(ctx: Ctx): Evidence {
  const names = ctx.input.autonomy.join(", ").replace(/_/g, " ");
  return { kind: "observed", text: `Autonomy you selected: ${names}` };
}

// ── Rule outcomes ────────────────────────────────────────────────────────────────────────────

type Outcome = {
  inherent: number;
  headline: string;
  why: string;
  impact: string;
  mitigations: string[];
  evidence: Evidence[];
  weights: Partial<Record<ControlId, number>>;
  /** Controls to cite as evidence. */
  cite: ControlId[];
  /** Override the computed mitigation (e.g. a secret already pasted into a config cannot be "isolated" away). */
  forceMitigation?: number;
};

type Rule = (ctx: Ctx) => Outcome | null;

const clamp = (n: number) => Math.min(4, Math.max(1, n));

const RULES: Record<RiskCategory, Rule> = {
  excessive_permissions(ctx) {
    const all = [...ctx.caps];
    const power = all.reduce((sum, id) => sum + CAPABILITY_BY_ID[id].power, 0);
    if (all.length < 3 || power < 4) return null;
    const inherent = power >= 28 ? 4 : power >= 16 ? 3 : power >= 8 ? 2 : 1;
    const groups = new Set(all.map((id) => CAPABILITY_BY_ID[id].group)).size;
    return {
      inherent,
      headline: `Your agent has ${all.length} capabilities across ${groups} ${groups === 1 ? "area" : "areas"}.`,
      why: "What an agent can reach is the ceiling on what can go wrong. Access beyond what its task needs turns any mistake, manipulation or compromise into a larger incident.",
      impact: "A compromised or misbehaving agent could read or change everything it has been granted, not only what its current task requires.",
      mitigations: [
        "Grant only the tools and data the task needs, and remove the rest.",
        "Scope each grant to specific resources (a folder, a table, a mailbox) instead of whole systems.",
        "Review grants on a schedule and remove the ones that go unused.",
      ],
      evidence: [...capabilityEvidence(ctx, all)],
      weights: { tool_permissions: 0.6, policy_enforcement: 0.4 },
      cite: ["tool_permissions", "policy_enforcement"],
    };
  },

  unrestricted_tool_access(ctx) {
    const power = present(ctx, POWER_TOOLS);
    const tools = [...ctx.caps].filter((id) => CAPABILITY_BY_ID[id].group === "tools");
    if (power.length === 0 && tools.length < 4) return null;
    let inherent = power.length >= 2 ? 4 : power.length === 1 ? 3 : 2;
    if (ctx.rank <= 1) inherent -= 1;
    return {
      inherent: clamp(inherent),
      headline: power.length > 0 ? `Your agent can use powerful tools (${labels(power)}).` : `Your agent can use ${tools.length} different tools.`,
      why: "Tools turn text into effects. When a powerful tool is available without per-call restrictions, anything that steers the model — a bad prompt, a bad document, a bug — can steer that tool.",
      impact: "The agent could invoke high-impact tools in ways nobody intended, at the speed of the model rather than the speed of review.",
      mitigations: [
        "Allow-list tools per task, and deny by default.",
        "Constrain tool arguments (allowed paths, hosts, accounts) rather than trusting the model to.",
        "Put an approval or policy check in front of the most powerful tools.",
      ],
      evidence: [...capabilityEvidence(ctx, tools), autonomyEvidence(ctx)],
      weights: { tool_permissions: 0.5, policy_enforcement: 0.3, sandboxing: 0.2 },
      cite: ["tool_permissions", "policy_enforcement", "sandboxing"],
    };
  },

  autonomous_external_actions(ctx) {
    const ext = present(ctx, EXTERNAL_ACTIONS);
    if (ext.length === 0 || ctx.rank < 3) return null;
    const maxImpact = Math.max(...ext.map((id) => CAPABILITY_BY_ID[id].power));
    const inherent = ctx.rank === 3 ? maxImpact - 1 : ctx.rank === 4 ? maxImpact : maxImpact + 1;
    return {
      inherent: clamp(inherent),
      headline: `Your agent can take actions that affect outside systems (${labels(ext)}) without a person approving each one.`,
      why: "Actions like these leave the agent's own environment. They can't be quietly undone, and they reach people, money or systems that never agreed to the agent's mistakes.",
      impact: "A compromised agent, a malicious instruction or an unintended model behavior could cause unauthorized external communication, spending or changes.",
      mitigations: [
        "Require approval before external actions, at least for the highest-impact ones.",
        "Cap volume and value per period so a runaway loop stays small.",
        "Run new actions in a draft or dry-run mode first.",
      ],
      evidence: [...capabilityEvidence(ctx, ext), autonomyEvidence(ctx)],
      weights: { approval_gates: 0.5, policy_enforcement: 0.25, human_in_loop: 0.15, rate_limits: 0.1 },
      cite: ["approval_gates", "policy_enforcement", "human_in_loop", "rate_limits"],
    };
  },

  sensitive_data_exposure(ctx) {
    const sens = present(ctx, SENSITIVE_DATA);
    if (sens.length === 0) return null;
    const maxPower = Math.max(...sens.map((id) => CAPABILITY_BY_ID[id].power));
    const outbound = present(ctx, OUTBOUND);
    const inherent = maxPower + (sens.length >= 2 && outbound.length > 0 && ctx.rank >= 3 ? 1 : 0);
    const evidence = [...capabilityEvidence(ctx, sens)];
    if (outbound.length > 0) evidence.push({ kind: "observed", text: `It also has ways to send data out: ${labels(outbound)}` });
    return {
      inherent: clamp(inherent),
      headline: `Your agent can access sensitive data (${labels(sens)}).`,
      why: "Sensitive data is only as private as the least careful thing that can read it. An agent that can both read it and communicate outward is a possible path for it to leave.",
      impact: "Customer, financial or private information could be disclosed, altered or exfiltrated through the agent, with regulatory and trust consequences.",
      mitigations: [
        "Give the agent the narrowest view of the data it needs (specific tables, fields or folders).",
        "Restrict where it can send data: approved hosts and recipients only.",
        "Log which data classes each action touches and review unusual access.",
      ],
      evidence,
      weights: { network_restrictions: 0.3, tool_permissions: 0.3, action_monitoring: 0.2, audit_logs: 0.2 },
      cite: ["network_restrictions", "tool_permissions", "action_monitoring", "audit_logs"],
    };
  },

  code_execution_risk(ctx) {
    const exec = present(ctx, ["code_execution", "shell"]);
    if (exec.length === 0) return null;
    let inherent = exec.length === 2 && ctx.rank >= 3 ? 4 : 3;
    if (ctx.rank <= 2) inherent -= 1;
    else if (ctx.rank >= 4) inherent += 1;
    return {
      inherent: clamp(inherent),
      headline: `Your agent can run code or commands (${labels(exec)}).`,
      why: "Code execution is the broadest capability an agent can have. Whatever the process can do, the agent can do — including things nobody listed as a capability.",
      impact: "Arbitrary or high-impact code could read files, reach the network, install software or use credentials available to the process.",
      mitigations: [
        "Run code in an isolated sandbox with no access to production credentials or data.",
        "Deny outbound network access from the sandbox by default.",
        "Require approval for commands that write, delete, install or reach the network.",
      ],
      evidence: [...capabilityEvidence(ctx, exec), autonomyEvidence(ctx)],
      weights: { sandboxing: 0.55, approval_gates: 0.15, network_restrictions: 0.15, policy_enforcement: 0.15 },
      cite: ["sandboxing", "approval_gates", "network_restrictions", "policy_enforcement"],
    };
  },

  prompt_injection_exposure(ctx) {
    if (ctx.untrusted.length === 0) return null;
    const factors = [
      present(ctx, [...SENSITIVE_DATA, "credentials_secrets"]).length > 0,
      present(ctx, ["send_emails", ...EXTERNAL_ACTIONS]).length > 0,
      present(ctx, ["code_execution", "shell"]).length > 0,
    ].filter(Boolean).length;
    const anyAction = present(ctx, ["modify_files", ...EXTERNAL_ACTIONS]).length > 0;
    if (factors === 0 && !anyAction) return null;
    let inherent = factors >= 2 ? 4 : factors === 1 ? 3 : 2;
    if (ctx.rank <= 1) inherent -= 1;
    const privileges = present(ctx, [...SENSITIVE_DATA, "credentials_secrets", ...EXTERNAL_ACTIONS, "modify_files", "code_execution", "shell"]);
    return {
      inherent: clamp(inherent),
      headline: "Your agent may read content it doesn't control while holding privileges an attacker could try to misuse.",
      why: "Text from web pages, emails or tickets can contain instructions aimed at the model. If the same agent can reach private data or take actions, that text becomes a possible route to them.",
      impact: "Hidden instructions in untrusted content could potentially cause data disclosure or unintended actions, and the user would see nothing wrong.",
      mitigations: [
        "Separate agents that read untrusted content from agents that hold privileges, or strip privileges while untrusted content is in context.",
        "Require approval for any privileged action taken after reading external content.",
        "Restrict outbound destinations so injected instructions can't send data anywhere.",
      ],
      evidence: [...ctx.untrusted, ...capabilityEvidence(ctx, privileges)],
      weights: { approval_gates: 0.3, tool_permissions: 0.25, network_restrictions: 0.2, policy_enforcement: 0.15, sandboxing: 0.1 },
      cite: ["approval_gates", "tool_permissions", "network_restrictions"],
    };
  },

  missing_approval_gates(ctx) {
    const impactful = [...ctx.caps].filter(
      (id) => (CAPABILITY_BY_ID[id].group === "actions" && CAPABILITY_BY_ID[id].power >= 3) || POWER_TOOLS.includes(id)
    );
    if (impactful.length === 0 || ctx.rank < 2) return null;
    const maxPower = Math.max(...impactful.map((id) => CAPABILITY_BY_ID[id].power));
    const inherent = ctx.rank === 2 ? maxPower - 1 : ctx.rank === 5 ? maxPower + 1 : maxPower;
    return {
      inherent: clamp(inherent),
      headline: `High-impact capabilities (${labels(impactful)}) are not confirmed to sit behind an approval gate.`,
      why: "An approval gate is a control that is enforced outside the model. A policy written only in the prompt can be talked around; a gate in the execution path cannot.",
      impact: "High-impact actions could run without anyone seeing them first, including actions the agent was manipulated into choosing.",
      mitigations: [
        "Enforce approval in the execution path, not in the prompt.",
        "Gate by impact: let low-risk actions run, hold the ones that move money, send messages or change systems.",
        "Make approvals specific to the exact action, and make them expire.",
      ],
      evidence: [...capabilityEvidence(ctx, impactful), autonomyEvidence(ctx)],
      weights: { approval_gates: 0.7, human_in_loop: 0.3 },
      cite: ["approval_gates", "human_in_loop"],
    };
  },

  missing_monitoring(ctx) {
    const power = [...ctx.caps].map((id) => CAPABILITY_BY_ID[id].power);
    const maxPower = power.length === 0 ? 0 : Math.max(...power);
    if (maxPower < 2 || ctx.rank < 1) return null;
    let inherent = maxPower >= 4 ? 3 : maxPower === 3 ? (ctx.rank >= 3 ? 3 : 2) : ctx.rank >= 3 ? 2 : 1;
    if (ctx.rank === 5) inherent += 1;
    return {
      inherent: clamp(inherent),
      headline: "Whether your agent's actions can be centrally observed and audited is not confirmed.",
      why: "If you can't reconstruct what an agent did, you can't investigate an incident, prove what happened, or notice that its behavior has drifted.",
      impact: "Misbehavior or compromise could go unnoticed for a long time, and afterwards there may be no reliable record of what happened.",
      mitigations: [
        "Record every tool call with its inputs, outputs, time and the identity it ran as, somewhere the agent cannot edit.",
        "Alert on unusual actions, destinations and volumes.",
        "Review a sample of actions regularly even when nothing has alerted.",
      ],
      evidence: [...controlEvidence(ctx, ["audit_logs", "action_monitoring"]), autonomyEvidence(ctx)],
      weights: { audit_logs: 0.5, action_monitoring: 0.5 },
      cite: ["audit_logs", "action_monitoring"],
    };
  },

  weak_secrets_isolation(ctx) {
    const hasCreds = ctx.caps.has("credentials_secrets");
    const secretsPasted = hasSecretLikeContent(ctx.pasted);
    const secretsState = ctx.input.controls.secrets_isolation;
    const holdsToolAccess = present(ctx, ["cloud_services", "shell", "code_execution", "apis"]).length > 0;
    const evidence: Evidence[] = [];
    let inherent = 0;
    let forced: number | undefined;

    if (hasCreds) {
      const exfil = present(ctx, ["code_execution", "shell", "web_browsing", "send_emails", "apis"]).length > 0 || ctx.untrusted.length > 0;
      inherent = exfil ? 4 : 3;
      evidence.push(...capabilityEvidence(ctx, ["credentials_secrets"]));
      if (exfil) evidence.push({ kind: "observed", text: "It also has ways to send data out or reads content from outside your organization" });
    }
    if (secretsPasted) {
      const n = ctx.pasted!.signals.filter((s) => s.id.startsWith("secret_")).reduce((sum, s) => sum + s.count, 0);
      inherent = Math.max(inherent, 3);
      forced = 0; // A secret already sitting in a prompt or config is exposed regardless of isolation controls.
      evidence.push({ kind: "observed", text: `Your pasted content contains ${n} secret-like ${n === 1 ? "string" : "strings"} (the values were not stored or displayed)` });
    }
    if (inherent === 0 && holdsToolAccess && secretsState === "not_in_place") {
      inherent = 2;
      evidence.push({ kind: "inferred", text: "It uses tools that typically need credentials, and you reported no secrets isolation" });
    }
    if (inherent === 0) return null;
    evidence.push(...controlEvidence(ctx, ["secrets_isolation"]));
    return {
      inherent: clamp(inherent),
      headline: secretsPasted ? "Your pasted content appears to include credentials." : "Credentials may be visible to your agent.",
      why: "A credential the agent can read is a credential anything that steers the agent can try to read. Isolation keeps the key in a layer the model never sees.",
      impact: "Leaked or misused credentials could give an attacker the agent's access, or more, outside the agent entirely.",
      mitigations: [
        ...(secretsPasted ? ["Rotate any credential that appeared in a prompt, config or log, then remove it from that text."] : []),
        "Keep credentials in a secrets manager or tool-side broker so the model only ever receives results.",
        "Use short-lived, narrowly scoped tokens per task.",
        "Never place credentials in prompts, tool descriptions or logs.",
      ],
      evidence,
      weights: { secrets_isolation: 0.7, network_restrictions: 0.15, audit_logs: 0.15 },
      cite: [],
      forceMitigation: forced,
    };
  },

  excessive_blast_radius(ctx) {
    const reach = [
      ctx.caps.has("databases"),
      ctx.caps.has("cloud_services"),
      ctx.caps.has("file_system"),
      ctx.caps.has("email"),
      ctx.caps.has("apis"),
      ctx.caps.has("shell") || ctx.caps.has("code_execution"),
      ctx.caps.has("make_purchases") || ctx.caps.has("execute_transactions"),
      ctx.caps.has("send_emails"),
      ctx.caps.has("change_configurations") || ctx.caps.has("create_accounts"),
    ].filter(Boolean).length;
    if (reach < 3) return null;
    const destructive = present(ctx, DESTRUCTIVE);
    let inherent = reach >= 7 ? 4 : reach >= 5 ? 3 : 2;
    if (destructive.length > 0 && ctx.rank >= 4) inherent += 1;
    if (ctx.rank <= 1) inherent -= 1;
    return {
      inherent: clamp(inherent),
      headline: `A single failure of your agent could reach about ${reach} separate kinds of system.`,
      why: "Blast radius is how far one mistake or compromise spreads. The more systems share one agent's identity, the less any single control can contain.",
      impact: "A compromised or misbehaving agent could affect many systems at once, making containment and recovery slower and more expensive.",
      mitigations: [
        "Split broad agents into narrower ones with separate identities and grants.",
        "Isolate environments: no shared credentials between production and everything else.",
        "Keep a fast way to pause or revoke the agent, and rehearse it.",
      ],
      evidence: [...capabilityEvidence(ctx, [...ctx.caps]), autonomyEvidence(ctx)],
      weights: { sandboxing: 0.25, tool_permissions: 0.3, network_restrictions: 0.2, rate_limits: 0.25 },
      cite: ["tool_permissions", "network_restrictions", "rate_limits"],
    };
  },
};

// ── Assembly ─────────────────────────────────────────────────────────────────────────────────

function buildCtx(input: ScanInput, pasted: PastedSignalSummary | null): Ctx {
  const observed = new Set<CapabilityId>(input.capabilities);
  const inferred = new Set<CapabilityId>(pasted?.inferredCapabilities ?? []);
  const caps = new Set<CapabilityId>([...observed, ...inferred]);
  const rank = input.autonomy.length === 0 ? 2 : Math.max(...input.autonomy.map((a) => AUTONOMY_RANK[a]));

  const untrusted: Evidence[] = [];
  if (observed.has("web_browsing")) untrusted.push({ kind: "observed", text: "It browses the web, which means reading pages written by others" });
  else if (inferred.has("web_browsing")) untrusted.push({ kind: "inferred", text: "Your pasted content references web access, which means reading pages written by others" });
  if (observed.has("email")) untrusted.push({ kind: "observed", text: "It reads email, which includes messages from outside your organization" });
  const profile = AGENT_TYPE_PROFILE[input.agentType];
  if (profile.readsUntrustedContent && untrusted.length === 0) {
    const typeLabel = AGENT_TYPES.find((t) => t.id === input.agentType)!.label.toLowerCase();
    untrusted.push({ kind: "inferred", text: `A ${typeLabel} typically reads content from outside your organization (inferred from the agent type)` });
  }
  return { input, caps, observed, inferred, rank, pasted, untrusted };
}

function stepsDown(m: number): number {
  return m >= 0.9 ? 3 : m >= 0.7 ? 2 : m >= 0.4 ? 1 : 0;
}

export function combinePoints(points: number[]): number {
  const remaining = points.reduce((acc, p) => acc * (1 - p / 100), 1);
  return Math.round(100 * (1 - remaining));
}

export function levelFor(score: number, hasCritical: boolean): RiskLevel {
  const byScore: RiskLevel = score >= LEVEL_THRESHOLDS.critical ? "critical" : score >= LEVEL_THRESHOLDS.high ? "high" : score >= LEVEL_THRESHOLDS.moderate ? "moderate" : "low";
  // A single critical finding is never summarised as less than High.
  return hasCritical && (byScore === "low" || byScore === "moderate") ? "high" : byScore;
}

export function runRiskEngine(input: ScanInput, pasted: PastedSignalSummary | null = null): ScanResult {
  const ctx = buildCtx(input, pasted);
  const findings: Finding[] = [];
  const protectedAreas: ProtectedArea[] = [];
  const notIndicated: NotIndicatedArea[] = [];

  for (const id of RISK_CATEGORIES) {
    const outcome = RULES[id](ctx);
    if (!outcome) {
      notIndicated.push({ id, title: CATEGORY_TITLE[id] });
      continue;
    }
    const m = outcome.forceMitigation ?? mitigation(ctx, outcome.weights);
    const residual = outcome.inherent - stepsDown(m);

    if (residual < 1) {
      const inPlace = outcome.cite.filter((c) => ctx.input.controls[c] === "in_place" || ctx.input.controls[c] === "partial").map(ctrlLabel);
      protectedAreas.push({
        id,
        title: CATEGORY_TITLE[id],
        because: inPlace.length > 0 ? `Exposure exists, and you reported: ${inPlace.join(", ").toLowerCase()}.` : "Exposure exists and the controls you reported offset it.",
      });
      continue;
    }

    const severity = sevOf(residual);
    findings.push({
      id,
      title: CATEGORY_TITLE[id],
      severity,
      inherentSeverity: sevOf(outcome.inherent),
      headline: outcome.headline,
      whyItMatters: outcome.why,
      evidence: [...outcome.evidence, ...controlEvidence(ctx, outcome.cite).filter((e) => !outcome.evidence.some((x) => x.text === e.text))],
      potentialImpact: outcome.impact,
      mitigations: outcome.mitigations,
      aegis: AEGIS_MAPPING[id],
      points: SEVERITY_POINTS[severity],
      dimension: CATEGORY_DIMENSION[id],
    });
  }

  // Most impactful first: points, then pre-control severity, then fixed category order (stable).
  const order = new Map(RISK_CATEGORIES.map((c, i) => [c, i]));
  findings.sort((a, b) => b.points - a.points || SEVERITIES.indexOf(b.inherentSeverity) - SEVERITIES.indexOf(a.inherentSeverity) || order.get(a.id)! - order.get(b.id)!);

  const score = combinePoints(findings.map((f) => f.points));
  const hasCritical = findings.some((f) => f.severity === "critical");
  const confirmed = CONTROLS.filter((c) => {
    const s = input.controls[c.id];
    return s !== undefined && s !== "unsure";
  }).length;

  return {
    engineVersion: ENGINE_VERSION,
    score,
    level: levelFor(score, hasCritical),
    counts: {
      high: findings.filter((f) => f.severity === "high" || f.severity === "critical").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      protectedAreas: protectedAreas.length,
    },
    findings,
    protectedAreas,
    notIndicated,
    breakdown: DIMENSIONS.map((dimension) => ({
      dimension,
      label: DIMENSION_LABEL[dimension],
      score: Math.max(0, ...findings.filter((f) => f.dimension === dimension).map((f) => BAR[f.severity])),
    })),
    fixFirst: findings.map((f) => f.id),
    controlsConfirmed: confirmed,
    controlsTotal: CONTROLS.length,
    pasted,
    disclaimer: SCORE_DISCLAIMER,
  };
}

/** Exposed for the docs/tests so the capability universe the rules reason over stays checkable. */
export const KNOWN_CAPABILITY_IDS = CAPABILITY_IDS;
