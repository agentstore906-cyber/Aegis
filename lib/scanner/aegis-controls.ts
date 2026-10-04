import type { AegisControlRef, AegisCoverage, RiskCategory } from "@/lib/scanner/types";

/**
 * Which Aegis capabilities answer which scanner finding — and, just as importantly, which don't exist.
 *
 * Honesty rules (docs/AEGIS_FREE_RISK_SCANNER.md §Security considerations):
 *   - `available`   — shipped and reachable at `href`.
 *   - `partial`     — shipped, but the note states the limit (e.g. it acts on what the agent REPORTS).
 *   - `coming_soon` — NOT built. Shown as such; never described as a working control.
 *   - `not_provided`— outside what Aegis does (it does not run, sandbox or firewall your agent).
 * Aegis returns decisions to agents that ask (SDK guard() / evaluate) and records what happened; it is
 * not in the agent's data path, so nothing here claims to "prevent" an action the agent doesn't route
 * through Aegis.
 */

export const AEGIS_CONTROLS = {
  agent_permissions: {
    id: "agent_permissions",
    name: "Per-agent tool permissions",
    status: "available",
    note: "Each agent holds explicit grants. A request with no matching grant is answered BLOCK (default-deny).",
    href: "/agents",
  },
  policies: {
    id: "policies",
    name: "Policies (allow, alert, require approval, block)",
    status: "available",
    note: "Checked when the agent asks Aegis for a decision. Your integration must honor the decision it returns.",
    href: "/policies",
  },
  approvals: {
    id: "approvals",
    name: "Human approval workflow",
    status: "available",
    note: "Requests wait for a named person; approvals expire and are bound to the exact action.",
    href: "/approvals",
  },
  audit_trail: {
    id: "audit_trail",
    name: "Append-only audit and activity trail",
    status: "available",
    note: "Decisions, approvals and reported activity are recorded and cannot be edited afterwards.",
    href: "/audit",
  },
  security_alerts: {
    id: "security_alerts",
    name: "Security alerts and incidents",
    status: "available",
    note: "Detectors raise alerts from reported activity; alerts can open incidents with an evidence timeline.",
    href: "/security",
  },
  behavioral_baselines: {
    id: "behavioral_baselines",
    name: "Behavioral baselines",
    status: "available",
    note: "Learns what is normal per agent (tools, destinations, volume) and flags deviations. Needs reported activity.",
    href: "/agents",
  },
  risk_control: {
    id: "risk_control",
    name: "Risk-driven control",
    status: "available",
    note: "Can raise the caution of a decision when a request looks risky. Starts in observe-only mode.",
    href: "/risk-control",
  },
  kill_switch: {
    id: "kill_switch",
    name: "Agent kill switch (pause / stop)",
    status: "available",
    note: "Pausing or stopping an agent makes Aegis answer BLOCK for every request it sends.",
    href: "/agents",
  },
  budgets: {
    id: "budgets",
    name: "Spend budgets",
    status: "partial",
    note: "Raises alerts when reported spend exceeds a budget. Monitoring only — it does not stop spending.",
    href: "/costs",
  },
  policy_simulator: {
    id: "policy_simulator",
    name: "Policy simulator",
    status: "available",
    note: "Test what a policy would decide for an action without recording anything.",
    href: "/policies/test",
  },
  data_class_policies: {
    id: "data_class_policies",
    name: "Data-class and destination conditions",
    status: "partial",
    note: "Policies can match data sensitivity and destination host, but only as reported by the agent.",
    href: "/policies",
  },
  secret_redaction: {
    id: "secret_redaction",
    name: "Secret redaction in telemetry",
    status: "partial",
    note: "Secret-like values in reported activity are masked before storage. This does not remove secrets from the agent.",
  },
  credential_brokering: {
    id: "credential_brokering",
    name: "Credential brokering for high-value tools",
    status: "coming_soon",
    note: "Not available yet. Today Aegis cannot keep credentials away from your agent.",
  },
  sandboxing: {
    id: "sandboxing",
    name: "Code sandboxing",
    status: "not_provided",
    note: "Aegis does not run or isolate your agent's code. Use a container, VM or sandbox service.",
  },
  network_egress: {
    id: "network_egress",
    name: "Network egress firewall",
    status: "not_provided",
    note: "Aegis cannot restrict network traffic. Enforce allow-lists at the network layer.",
  },
  injection_detection: {
    id: "injection_detection",
    name: "Prompt-injection detection",
    status: "not_provided",
    note: "Aegis does not inspect prompts or page content. It limits what an injected agent is allowed to do.",
  },
} as const satisfies Record<string, AegisControlRef>;

type ControlKey = keyof typeof AEGIS_CONTROLS;

const C = AEGIS_CONTROLS;

export const AEGIS_MAPPING: Record<RiskCategory, { coverage: AegisCoverage; summary: string; controls: AegisControlRef[] }> = {
  excessive_permissions: {
    coverage: "monitor_and_control",
    summary: "Aegis can hold the agent to explicit grants and flag grants that are broad or unused.",
    controls: [C.agent_permissions, C.policies],
  },
  unrestricted_tool_access: {
    coverage: "monitor_and_control",
    summary: "Aegis can require approval or return BLOCK for powerful tools when the agent asks before using them.",
    controls: [C.agent_permissions, C.policies, C.kill_switch],
  },
  autonomous_external_actions: {
    coverage: "monitor_and_control",
    summary: "Aegis can monitor these actions and enforce an approval policy before they run, for agents that ask Aegis first.",
    controls: [C.policies, C.approvals, C.risk_control, C.kill_switch],
  },
  sensitive_data_exposure: {
    coverage: "partial",
    summary: "Aegis can record and gate actions by the data class and destination the agent reports. It cannot see data it is not told about.",
    controls: [C.data_class_policies, C.audit_trail, C.security_alerts],
  },
  code_execution_risk: {
    coverage: "partial",
    summary: "Aegis can require approval before a code or shell tool is used. Isolating execution is outside what Aegis does.",
    controls: [C.policies, C.approvals, C.sandboxing],
  },
  prompt_injection_exposure: {
    coverage: "partial",
    summary: "Aegis limits what a manipulated agent may do and flags behavior that departs from its baseline. It does not detect injections.",
    controls: [C.approvals, C.behavioral_baselines, C.security_alerts, C.injection_detection],
  },
  missing_approval_gates: {
    coverage: "monitor_and_control",
    summary: "Aegis provides the approval gate: matching actions wait for a person before the agent receives an allow.",
    controls: [C.policies, C.approvals, C.policy_simulator],
  },
  missing_monitoring: {
    coverage: "monitor",
    summary: "Aegis records every decision and the activity your agent reports, in a trail that cannot be edited afterwards.",
    controls: [C.audit_trail, C.security_alerts, C.behavioral_baselines],
  },
  weak_secrets_isolation: {
    coverage: "guidance_only",
    summary: "Aegis cannot isolate credentials today. It can mask secret-like values in telemetry; credential brokering is not built yet.",
    controls: [C.secret_redaction, C.credential_brokering],
  },
  excessive_blast_radius: {
    coverage: "partial",
    summary: "Aegis can stop an agent quickly and cap what each agent is granted. Network and sandbox containment are outside Aegis.",
    controls: [C.kill_switch, C.agent_permissions, C.budgets, C.network_egress],
  },
};

/** Distinct Aegis controls (by id) referenced by a set of findings, shipped ones first. */
export function controlsForCategories(categories: RiskCategory[]): AegisControlRef[] {
  const seen = new Map<string, AegisControlRef>();
  for (const category of categories) {
    for (const control of AEGIS_MAPPING[category].controls) if (!seen.has(control.id)) seen.set(control.id, control);
  }
  const order = { available: 0, partial: 1, coming_soon: 2, not_provided: 3 } as const;
  return [...seen.values()].sort((a, b) => order[a.status] - order[b.status]);
}

export type { ControlKey };
