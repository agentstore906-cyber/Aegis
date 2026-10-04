/**
 * The scanner's vocabulary. Every id here is an allowlisted enum value: user input is only ever
 * accepted as one of these ids (plus one short, sanitised free-text label for "Other"), which is
 * what keeps the analysis pipeline free of user-controlled strings. Pure data — no server imports,
 * so the wizard (client) and the engine (server) share exactly one definition.
 */

export const ENGINE_VERSION = "scanner-v1";

// ── Agent types ──────────────────────────────────────────────────────────────────────────────

export const AGENT_TYPES = [
  { id: "coding", label: "Coding agent", hint: "Writes, runs and changes code" },
  { id: "support", label: "Customer support agent", hint: "Answers or acts on customer requests" },
  { id: "research", label: "Research agent", hint: "Reads the web and documents to answer questions" },
  { id: "sales", label: "Sales agent", hint: "Prospects, emails and updates CRM" },
  { id: "finance", label: "Finance agent", hint: "Touches invoices, payments or ledgers" },
  { id: "internal", label: "Internal company agent", hint: "Works across internal tools and data" },
  { id: "browser", label: "Browser agent", hint: "Drives a browser on a user's behalf" },
  { id: "workflow", label: "Autonomous workflow agent", hint: "Runs multi-step jobs on its own" },
  { id: "other", label: "Other", hint: "Describe it in your own words" },
] as const;
export type AgentTypeId = (typeof AGENT_TYPES)[number]["id"];
export const AGENT_TYPE_IDS = AGENT_TYPES.map((t) => t.id) as [AgentTypeId, ...AgentTypeId[]];

/**
 * What an agent TYPE typically implies. Used only to (a) highlight likely capabilities in the UI and
 * (b) flag "reads untrusted content", which is reported as INFERRED, never as an observed fact.
 */
export const AGENT_TYPE_PROFILE: Record<AgentTypeId, { suggested: CapabilityId[]; readsUntrustedContent: boolean }> = {
  coding: { suggested: ["file_system", "code_execution", "shell", "modify_files", "apis"], readsUntrustedContent: true },
  support: { suggested: ["customer_data", "email", "send_emails", "databases"], readsUntrustedContent: true },
  research: { suggested: ["web_browsing", "private_documents", "apis"], readsUntrustedContent: true },
  sales: { suggested: ["customer_data", "email", "send_emails", "apis"], readsUntrustedContent: true },
  finance: { suggested: ["financial_data", "databases", "execute_transactions", "make_purchases"], readsUntrustedContent: false },
  internal: { suggested: ["private_documents", "databases", "apis", "cloud_services"], readsUntrustedContent: false },
  browser: { suggested: ["web_browsing", "create_accounts", "make_purchases"], readsUntrustedContent: true },
  workflow: { suggested: ["apis", "cloud_services", "change_configurations"], readsUntrustedContent: false },
  other: { suggested: [], readsUntrustedContent: false },
};

// ── Capabilities ─────────────────────────────────────────────────────────────────────────────

export type CapabilityGroup = "data" | "tools" | "actions";

export type CapabilityDef = {
  id: string;
  group: CapabilityGroup;
  label: string;
  hint: string;
  /** 1–4: how much damage/exposure this capability alone can represent. Drives breadth and impact. */
  power: 1 | 2 | 3 | 4;
};

export const CAPABILITIES = [
  // Data
  { id: "private_documents", group: "data", label: "Private documents", hint: "Internal files, wikis, drive", power: 2 },
  { id: "customer_data", group: "data", label: "Customer data", hint: "Names, contacts, tickets, accounts", power: 3 },
  { id: "financial_data", group: "data", label: "Financial data", hint: "Invoices, payments, ledgers", power: 3 },
  { id: "credentials_secrets", group: "data", label: "Credentials / secrets", hint: "API keys, tokens, passwords", power: 4 },
  { id: "email", group: "data", label: "Email", hint: "Reads a mailbox", power: 3 },
  { id: "databases", group: "data", label: "Databases", hint: "Queries production or internal data stores", power: 3 },
  // Tools
  { id: "web_browsing", group: "tools", label: "Web browsing", hint: "Fetches or renders web pages", power: 2 },
  { id: "code_execution", group: "tools", label: "Code execution", hint: "Runs code it writes or is given", power: 4 },
  { id: "shell", group: "tools", label: "Shell / terminal", hint: "Runs commands on a machine", power: 4 },
  { id: "apis", group: "tools", label: "APIs", hint: "Calls third-party or internal APIs", power: 2 },
  { id: "file_system", group: "tools", label: "File system", hint: "Reads and writes local files", power: 2 },
  { id: "cloud_services", group: "tools", label: "Cloud services", hint: "Cloud consoles, infrastructure, storage", power: 3 },
  // Actions
  { id: "send_emails", group: "actions", label: "Send emails", hint: "Sends messages to people outside the agent", power: 3 },
  { id: "modify_files", group: "actions", label: "Modify files", hint: "Creates or edits files", power: 2 },
  { id: "delete_data", group: "actions", label: "Delete data", hint: "Removes records, files or resources", power: 3 },
  { id: "make_purchases", group: "actions", label: "Make purchases", hint: "Spends money on goods or services", power: 4 },
  { id: "create_accounts", group: "actions", label: "Create accounts", hint: "Registers users or service accounts", power: 3 },
  { id: "change_configurations", group: "actions", label: "Change configurations", hint: "Alters settings, permissions or infrastructure", power: 3 },
  { id: "execute_transactions", group: "actions", label: "Execute transactions", hint: "Moves money or commits financial operations", power: 4 },
] as const satisfies readonly CapabilityDef[];
export type CapabilityId = (typeof CAPABILITIES)[number]["id"];
export const CAPABILITY_IDS = CAPABILITIES.map((c) => c.id) as [CapabilityId, ...CapabilityId[]];
export const CAPABILITY_BY_ID = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c])) as Record<CapabilityId, CapabilityDef>;
export const CAPABILITY_GROUPS: { id: CapabilityGroup; label: string; question: string }[] = [
  { id: "data", label: "Data", question: "What data can it read?" },
  { id: "tools", label: "Tools", question: "What tools can it use?" },
  { id: "actions", label: "Actions", question: "What can it change or send?" },
];

// ── Autonomy ─────────────────────────────────────────────────────────────────────────────────

export const AUTONOMY_LEVELS = [
  { id: "read_only", rank: 0, label: "Read only", hint: "It can look, but not change anything" },
  { id: "suggest", rank: 1, label: "Suggests actions", hint: "A person carries them out" },
  { id: "with_approval", rank: 2, label: "Executes actions with approval", hint: "A person approves each one" },
  { id: "low_risk_auto", rank: 3, label: "Executes low-risk actions automatically", hint: "Approval only for the rest" },
  { id: "autonomous", rank: 4, label: "Executes actions autonomously", hint: "No approval step" },
  { id: "fully_autonomous", rank: 5, label: "Fully autonomous", hint: "Runs unattended, chooses its own goals or steps" },
] as const;
export type AutonomyId = (typeof AUTONOMY_LEVELS)[number]["id"];
export const AUTONOMY_IDS = AUTONOMY_LEVELS.map((a) => a.id) as [AutonomyId, ...AutonomyId[]];
export const AUTONOMY_RANK = Object.fromEntries(AUTONOMY_LEVELS.map((a) => [a.id, a.rank])) as Record<AutonomyId, number>;

// ── Security controls ────────────────────────────────────────────────────────────────────────

export const CONTROLS = [
  { id: "tool_permissions", label: "Tool permissions", hint: "The agent can only call tools it has been granted" },
  { id: "approval_gates", label: "Approval gates", hint: "High-impact actions are blocked until a person approves" },
  { id: "sandboxing", label: "Sandboxing", hint: "Code and commands run in an isolated environment" },
  { id: "audit_logs", label: "Audit logs", hint: "Actions are recorded somewhere the agent can't edit" },
  { id: "human_in_loop", label: "Human-in-the-loop controls", hint: "A person reviews or can interrupt risky steps" },
  { id: "secrets_isolation", label: "Secrets isolation", hint: "The agent never holds raw credentials" },
  { id: "network_restrictions", label: "Network restrictions", hint: "Outbound traffic is limited to approved destinations" },
  { id: "rate_limits", label: "Rate limits", hint: "Caps on actions, spend or volume per period" },
  { id: "action_monitoring", label: "Action monitoring", hint: "Someone or something watches what the agent does" },
  { id: "policy_enforcement", label: "Policy enforcement", hint: "Rules are checked before actions run" },
] as const;
export type ControlId = (typeof CONTROLS)[number]["id"];
export const CONTROL_IDS = CONTROLS.map((c) => c.id) as [ControlId, ...ControlId[]];

/** "unsure" is a real answer, not a missing one: it earns only a sliver of mitigation credit. */
export const CONTROL_STATES = ["in_place", "partial", "not_in_place", "unsure"] as const;
export type ControlState = (typeof CONTROL_STATES)[number];
export const CONTROL_STATE_LABEL: Record<ControlState, string> = {
  in_place: "In place",
  partial: "Partly",
  not_in_place: "Not in place",
  unsure: "Not sure",
};
/** How much of a control's mitigation weight each answer earns. Documented in docs/AEGIS_FREE_RISK_SCANNER.md. */
export const CONTROL_CREDIT: Record<ControlState, number> = { in_place: 1, partial: 0.5, unsure: 0.15, not_in_place: 0 };

// ── Limits ───────────────────────────────────────────────────────────────────────────────────

export const LIMITS = {
  /** Pasted configuration / prompt / log text. Anything longer is rejected, never truncated silently. */
  maxAdvancedChars: 10_000,
  maxAgentLabelChars: 60,
  /** Hard cap on the raw request body, checked before JSON parsing. */
  maxBodyBytes: 48 * 1024,
} as const;
