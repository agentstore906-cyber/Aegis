import "dotenv/config";
import {
  PrismaClient,
  type ActivityStatus,
  type ActivityType,
  type ConditionOperator,
  type Environment,
  type PolicyDecision,
  type RiskLevel,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import { parseDatabaseUrl } from "../lib/db-connection";

// The real policy engine (lib/policies/matcher.ts, resolver.ts) is reused
// below to generate evaluation history — these seeded decisions are
// computed by the same logic that runs in production, not hand-faked.
// evaluate.ts and repository.ts are skipped because they're guarded with
// `server-only`, which this standalone script isn't running inside.
import { filterApplicablePolicies, resolveBestPermission } from "../lib/policies/matcher";
import { resolveDecision } from "../lib/policies/resolver";
import type { PolicyEvaluationInput } from "../lib/policies/types";

// Phase 5's detectors (lib/security/detectors.ts) are pure functions — no
// `server-only` guard — so, like the policy engine above, they're reused
// directly here rather than hand-faked. See buildSecurityAlertScenarios().
import { detectCostSpike, detectNewSensitiveAction } from "../lib/security/detectors";

const adapter = new PrismaPg(parseDatabaseUrl(process.env.DATABASE_URL!));
const prisma = new PrismaClient({ adapter });

const COMPANIES = [
  "Acme Inc.",
  "Globex Corp",
  "Initech",
  "Umbrella Co",
  "Stark Industries",
  "Wayne Enterprises",
  "Hooli",
  "Soylent Corp",
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedStatus(
  weights: Partial<Record<ActivityStatus, number>>
): ActivityStatus {
  const entries = Object.entries(weights) as [ActivityStatus, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [status, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return entries[0][0];
}

/** Skews toward recent timestamps within the last `days` days. */
function recentTimestamp(days: number): Date {
  const skew = Math.random() * Math.random();
  const msAgo = skew * days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

type ActionTemplate = {
  action: string;
  eventType: ActivityType;
  riskLevel: RiskLevel;
  resource: () => string;
  statusWeights: Partial<Record<ActivityStatus, number>>;
  costCentsRange: [number, number];
  durationMsRange: [number, number];
  metadata?: () => Record<string, string | number>;
};

type PermissionSeed = {
  action: string;
  resource?: string;
  decision: PolicyDecision;
  description?: string;
};

type AgentSeed = {
  name: string;
  owner: string;
  team?: string; // matches a name in TEAMS below — optional, so one agent stays team-less to demo the "no team" fallback
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT";
  status: "ACTIVE" | "PAUSED" | "NEEDS_ATTENTION" | "ARCHIVED";
  riskLevel: RiskLevel;
  modelProvider: string;
  modelName: string;
  framework?: string;
  sdkVersion?: string;
  description: string;
  tools: { name: string; category: string }[];
  actions: ActionTemplate[];
  permissions: PermissionSeed[];
  lastActiveMinutesAgo: number;
  eventCount: number;
};

const TEAMS = ["Revenue", "Platform", "Finance"] as const;

const AGENTS: AgentSeed[] = [
  {
    name: "Sales Agent",
    owner: "Revenue",
    team: "Revenue",
    environment: "PRODUCTION",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    modelProvider: "OpenAI",
    modelName: "gpt-4.1",
    framework: "LangChain",
    sdkVersion: "0.4.2",
    description: "Qualifies inbound leads, enriches CRM records, and drafts outbound emails.",
    tools: [
      { name: "CRM", category: "Data" },
      { name: "Email", category: "Communication" },
    ],
    permissions: [
      { action: "crm.contact.read", decision: "ALLOW" },
      { action: "crm.contact.update", decision: "ALLOW" },
      { action: "email.generate", decision: "ALLOW" },
      { action: "email.send", decision: "REQUIRE_APPROVAL", description: "Outbound email needs a human glance first." },
      { action: "crm.export", decision: "BLOCK", description: "Bulk customer export is never automatic." },
    ],
    lastActiveMinutesAgo: 2,
    eventCount: 38,
    actions: [
      {
        action: "read_crm_contact",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `contact:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [120, 400],
      },
      {
        action: "search_company",
        eventType: "TOOL_CALL",
        riskLevel: "LOW",
        resource: () => `company:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 2],
        durationMsRange: [300, 900],
      },
      {
        action: "generate_outbound_email",
        eventType: "MODEL_CALL",
        riskLevel: "LOW",
        resource: () => `draft:${randomUUID().slice(0, 8)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [15, 60],
        durationMsRange: [800, 2400],
      },
      {
        action: "send_email",
        eventType: "COMMUNICATION",
        riskLevel: "MEDIUM",
        resource: () => `email:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 0.8, APPROVAL_REQUIRED: 0.2 },
        costCentsRange: [0, 1],
        durationMsRange: [150, 500],
      },
      {
        action: "update_crm_deal",
        eventType: "ACTION",
        riskLevel: "MEDIUM",
        resource: () => `deal:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 0.92, FAILED: 0.08 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 700],
      },
    ],
  },
  {
    name: "Support Agent",
    owner: "Support",
    team: "Revenue",
    environment: "PRODUCTION",
    status: "ACTIVE",
    riskLevel: "LOW",
    modelProvider: "Anthropic",
    modelName: "claude-sonnet-4.5",
    framework: "custom",
    sdkVersion: "0.4.2",
    description: "Triages inbound support tickets and drafts customer replies.",
    tools: [{ name: "Zendesk", category: "Communication" }],
    permissions: [
      { action: "ticket.read", decision: "ALLOW" },
      { action: "ticket.reply", decision: "ALLOW" },
      { action: "ticket.escalate", decision: "ALLOW" },
      { action: "customer.export", decision: "BLOCK" },
    ],
    lastActiveMinutesAgo: 0,
    eventCount: 44,
    actions: [
      {
        action: "read_ticket",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `ticket:#${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [100, 350],
      },
      {
        action: "analyze_support_ticket",
        eventType: "MODEL_CALL",
        riskLevel: "LOW",
        resource: () => `ticket:#${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [10, 45],
        durationMsRange: [600, 1800],
      },
      {
        action: "search_account_history",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `account:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [150, 500],
      },
      {
        action: "reply_to_customer",
        eventType: "COMMUNICATION",
        riskLevel: "LOW",
        resource: () => `ticket:#${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 0.97, FAILED: 0.03 },
        costCentsRange: [0, 1],
        durationMsRange: [150, 450],
      },
      {
        action: "escalate_ticket",
        eventType: "ACTION",
        riskLevel: "MEDIUM",
        resource: () => `ticket:#${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [100, 300],
      },
    ],
  },
  {
    name: "Finance Agent",
    owner: "Finance",
    team: "Finance",
    environment: "PRODUCTION",
    status: "ACTIVE",
    riskLevel: "HIGH",
    modelProvider: "OpenAI",
    modelName: "gpt-4.1",
    framework: "custom",
    sdkVersion: "0.3.9",
    description: "Reviews billing anomalies and processes customer refund requests.",
    tools: [{ name: "Billing", category: "Financial" }],
    permissions: [
      { action: "invoice.read", decision: "ALLOW" },
      { action: "invoice.create", decision: "ALLOW" },
      { action: "refund.issue", decision: "REQUIRE_APPROVAL", description: "Refunds always get a second look." },
      { action: "invoice.delete", decision: "BLOCK" },
      { action: "bank_account.change", decision: "BLOCK", description: "Never automatable — high fraud risk." },
    ],
    lastActiveMinutesAgo: 4,
    eventCount: 30,
    actions: [
      {
        action: "read_invoice",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `invoice:inv_${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [120, 350],
      },
      {
        action: "calculate_refund_amount",
        eventType: "MODEL_CALL",
        riskLevel: "LOW",
        resource: () => `invoice:inv_${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [8, 30],
        durationMsRange: [500, 1400],
      },
      {
        action: "issue_refund",
        eventType: "FINANCIAL",
        riskLevel: "HIGH",
        resource: () => `invoice:inv_${randomInt(1000, 9999)}`,
        statusWeights: { ALLOWED: 0.45, APPROVAL_REQUIRED: 0.45, BLOCKED: 0.1 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 600],
        metadata: () => ({
          amountUsd: randomInt(50, 2500),
          customer: pick(COMPANIES),
          reason: pick(["Customer cancellation", "Billing error", "Duplicate charge", "Service issue"]),
        }),
      },
      {
        action: "update_billing_record",
        eventType: "ACTION",
        riskLevel: "MEDIUM",
        resource: () => `account:${pick(COMPANIES)}`,
        statusWeights: { ALLOWED: 0.95, FAILED: 0.05 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 600],
      },
      {
        action: "export_financial_report",
        eventType: "DATA_ACCESS",
        riskLevel: "HIGH",
        resource: () => "report:monthly-financials",
        statusWeights: { ALLOWED: 0.5, BLOCKED: 0.5 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 500],
      },
    ],
  },
  {
    name: "Research Agent",
    owner: "Strategy",
    environment: "PRODUCTION",
    status: "PAUSED",
    riskLevel: "LOW",
    modelProvider: "Anthropic",
    modelName: "claude-sonnet-4.5",
    framework: "LangChain",
    sdkVersion: "0.4.0",
    description: "Gathers market and competitor research from the web and internal documents.",
    tools: [
      { name: "Web", category: "Data" },
      { name: "Drive", category: "Data" },
    ],
    permissions: [
      { action: "web.search", decision: "ALLOW" },
      { action: "document.read", decision: "ALLOW" },
      { action: "document.summarize", decision: "ALLOW" },
    ],
    lastActiveMinutesAgo: 60,
    eventCount: 26,
    actions: [
      {
        action: "external_search",
        eventType: "TOOL_CALL",
        riskLevel: "LOW",
        resource: () => `query:${pick(["market sizing", "competitor pricing", "industry trends", "regulatory news"])}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 2],
        durationMsRange: [400, 1200],
      },
      {
        action: "query_documentation",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => "docs:internal-wiki",
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [150, 450],
      },
      {
        action: "summarize_document",
        eventType: "MODEL_CALL",
        riskLevel: "LOW",
        resource: () => `file:${randomUUID().slice(0, 8)}.pdf`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [20, 90],
        durationMsRange: [900, 2600],
      },
      {
        action: "read_drive_file",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `file:${randomUUID().slice(0, 8)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [150, 400],
      },
    ],
  },
  {
    name: "Coding Agent",
    owner: "Platform",
    team: "Platform",
    environment: "STAGING",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    modelProvider: "Anthropic",
    modelName: "claude-opus-4.5",
    framework: "custom",
    sdkVersion: "0.4.2",
    description: "Runs test suites, opens pull requests, and fixes failing builds.",
    tools: [
      { name: "GitHub", category: "Development" },
      { name: "CI", category: "Development" },
    ],
    permissions: [
      { action: "repo.test.execute", decision: "ALLOW" },
      { action: "repo.pull_request.open", decision: "ALLOW" },
      { action: "repo.pull_request.merge", decision: "REQUIRE_APPROVAL" },
    ],
    lastActiveMinutesAgo: 6,
    eventCount: 42,
    actions: [
      {
        action: "execute_test_suite",
        eventType: "ACTION",
        riskLevel: "LOW",
        resource: () => "repo:aegis-core",
        statusWeights: { ALLOWED: 0.85, FAILED: 0.15 },
        costCentsRange: [5, 25],
        durationMsRange: [2000, 9000],
      },
      {
        action: "open_pull_request",
        eventType: "ACTION",
        riskLevel: "LOW",
        resource: () => "repo:aegis-core",
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [1, 3],
        durationMsRange: [500, 1500],
      },
      {
        action: "read_repository_file",
        eventType: "DATA_ACCESS",
        riskLevel: "LOW",
        resource: () => `file:src/${pick(["lib", "app", "components"])}/index.ts`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [80, 250],
      },
      {
        action: "run_lint",
        eventType: "ACTION",
        riskLevel: "LOW",
        resource: () => "repo:aegis-core",
        statusWeights: { ALLOWED: 0.9, FAILED: 0.1 },
        costCentsRange: [0, 1],
        durationMsRange: [800, 2200],
      },
      {
        action: "merge_pull_request",
        eventType: "ACTION",
        riskLevel: "MEDIUM",
        resource: () => `pr:#${randomInt(100, 999)}`,
        statusWeights: { ALLOWED: 0.9, APPROVAL_REQUIRED: 0.1 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 600],
      },
    ],
  },
  {
    name: "Deployment Agent",
    owner: "Platform",
    team: "Platform",
    environment: "PRODUCTION",
    status: "NEEDS_ATTENTION",
    riskLevel: "CRITICAL",
    modelProvider: "OpenAI",
    modelName: "gpt-4.1-mini",
    framework: "custom",
    sdkVersion: "0.3.7",
    description: "Automates preview, staging, and production deployments.",
    tools: [
      { name: "Kubernetes", category: "Deployment" },
      { name: "CI/CD", category: "Deployment" },
    ],
    permissions: [
      { action: "deployment.preview", decision: "ALLOW" },
      { action: "deployment.execute", decision: "REQUIRE_APPROVAL" },
      { action: "production.secret.read", decision: "BLOCK" },
    ],
    lastActiveMinutesAgo: 5,
    eventCount: 24,
    actions: [
      {
        action: "deploy_preview_environment",
        eventType: "DEPLOYMENT",
        riskLevel: "LOW",
        resource: () => `env:preview-${randomInt(100, 999)}`,
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [10, 40],
        durationMsRange: [3000, 12000],
      },
      {
        action: "deploy_staging",
        eventType: "DEPLOYMENT",
        riskLevel: "MEDIUM",
        resource: () => "env:staging",
        statusWeights: { ALLOWED: 0.85, FAILED: 0.15 },
        costCentsRange: [15, 60],
        durationMsRange: [4000, 15000],
      },
      {
        action: "deploy_production",
        eventType: "DEPLOYMENT",
        riskLevel: "CRITICAL",
        resource: () => "env:production",
        statusWeights: { BLOCKED: 0.4, APPROVAL_REQUIRED: 0.4, ALLOWED: 0.2 },
        costCentsRange: [0, 1],
        durationMsRange: [200, 800],
      },
      {
        action: "rollback_deployment",
        eventType: "DEPLOYMENT",
        riskLevel: "HIGH",
        resource: () => "env:production",
        statusWeights: { ALLOWED: 1 },
        costCentsRange: [0, 1],
        durationMsRange: [2000, 8000],
      },
      {
        action: "scale_service",
        eventType: "ACTION",
        riskLevel: "MEDIUM",
        resource: () => `service:${pick(["api", "worker", "gateway"])}`,
        statusWeights: { ALLOWED: 0.9, FAILED: 0.1 },
        costCentsRange: [0, 1],
        durationMsRange: [500, 1800],
      },
    ],
  },
];

type PolicyConditionSeed = { field: string; operator: ConditionOperator; value: unknown };

type PolicySeed = {
  name: string;
  description: string;
  decision: PolicyDecision;
  priority: number;
  agentName?: string; // undefined = applies to any agent
  action: string;
  environment?: Environment;
  conditions?: PolicyConditionSeed[];
};

const POLICIES: PolicySeed[] = [
  {
    name: "Refunds above $500",
    description: "Large refunds always need a human to sign off before they go out.",
    decision: "REQUIRE_APPROVAL",
    priority: 100,
    action: "refund.issue",
    conditions: [{ field: "context.amount", operator: "GREATER_THAN", value: 500 }],
  },
  {
    name: "Block customer deletion",
    description: "Deleting a customer record is never something an agent should do unattended.",
    decision: "BLOCK",
    priority: 200,
    action: "customer.delete",
  },
  {
    name: "Production deployments",
    description: "Any production deployment needs sign-off, regardless of which agent triggers it.",
    decision: "REQUIRE_APPROVAL",
    priority: 150,
    action: "deployment.execute",
    environment: "PRODUCTION",
  },
  {
    name: "Block customer export",
    description: "Bulk customer data export is blocked company-wide.",
    decision: "BLOCK",
    priority: 200,
    action: "crm.export",
  },
];

/**
 * A REQUIRE_APPROVAL scenario can optionally be tagged with how the human
 * reviewer resolved it, so the seed data shows the full Phase 3 loop
 * (request -> decision -> audit trail), not just PENDING requests. Left
 * untagged, a REQUIRE_APPROVAL scenario stays PENDING — e.g. the $1,250
 * refund, so there's always something to review in a fresh demo org.
 */
type SeedResolution = { decision: "APPROVED" | "REJECTED"; comment: string };
type SeedScenario = Omit<PolicyEvaluationInput, "organizationId"> & { resolution?: SeedResolution };

/**
 * A handful of realistic evaluation scenarios, run through the real policy
 * engine (matcher + resolver — see the imports above) so the seeded
 * evaluation history is exactly as trustworthy as production output, not
 * hand-faked. See docs/policy-engine.md section "Test scenarios".
 */
function buildScenarios(
  organizationId: string,
  agentIdByName: Map<string, string>
): (SeedScenario & { organizationId: string })[] {
  const salesId = agentIdByName.get("Sales Agent")!;
  const financeId = agentIdByName.get("Finance Agent")!;
  const deploymentId = agentIdByName.get("Deployment Agent")!;
  const codingId = agentIdByName.get("Coding Agent")!;
  const supportId = agentIdByName.get("Support Agent")!;
  const researchId = agentIdByName.get("Research Agent")!;

  const scenarios: SeedScenario[] = [
    { agentId: salesId, action: "crm.contact.read", resource: "contact:acme-inc" },
    { agentId: salesId, action: "crm.export" },
    { agentId: salesId, action: "customer.delete" }, // no permission configured — demonstrates policy-only BLOCK
    {
      agentId: salesId,
      action: "email.send",
      resource: "email:Umbrella Co",
      resolution: { decision: "REJECTED", comment: "Customer asked not to be contacted again — do not resend." },
    },
    { agentId: financeId, action: "refund.issue", context: { amount: 250, customer: "Globex Corp" } },
    // Left PENDING on purpose — the primary approval a fresh demo org has waiting.
    { agentId: financeId, action: "refund.issue", context: { amount: 1250, customer: "Acme Inc." } },
    { agentId: financeId, action: "refund.issue", context: { amount: 4200, customer: "Stark Industries" } },
    { agentId: financeId, action: "bank_account.change" },
    { agentId: financeId, action: "invoice.read", resource: "invoice:inv_4821" },
    { agentId: deploymentId, action: "deployment.preview" },
    {
      agentId: deploymentId,
      action: "deployment.execute",
      environment: "PRODUCTION",
      resolution: { decision: "APPROVED", comment: "Production deployment approved after QA sign-off." },
    },
    { agentId: deploymentId, action: "production.secret.read" },
    { agentId: codingId, action: "repo.test.execute" },
    { agentId: codingId, action: "repo.pull_request.merge", resource: "pr:#412" },
    { agentId: supportId, action: "ticket.read" },
    { agentId: supportId, action: "customer.export" },
    { agentId: researchId, action: "web.search" },
    { agentId: researchId, action: "web.execute_script" }, // unconfigured anywhere — demonstrates default BLOCK
  ];

  return scenarios.map((scenario) => ({ ...scenario, organizationId }));
}

/**
 * Mirrors lib/policies/evaluate.ts's orchestration (permission resolution ->
 * policy matching -> decision resolution -> persistence, plus approval
 * request + audit event creation on REQUIRE_APPROVAL) using only the pure,
 * non-`server-only` pieces of the engine, since this script runs outside
 * Next.js's server boundary and can't import server-only-guarded modules
 * (lib/policies/evaluate.ts, lib/approvals/repository.ts, lib/audit/service.ts).
 */
async function runSeedEvaluation(
  organizationId: string,
  input: SeedScenario & { organizationId: string }
): Promise<{ decision: PolicyDecision; approvalRequestId?: string }> {
  // `input.resolution` is seed-only metadata, not part of PolicyEvaluationInput —
  // harmless to pass through, since TS only excess-property-checks object literals.
  const evaluationInput = input;
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: input.agentId } });

  const [permissions, candidatePolicies] = await Promise.all([
    prisma.agentPermission.findMany({ where: { organizationId, agentId: input.agentId } }),
    prisma.policy.findMany({
      where: { organizationId, status: "ACTIVE", OR: [{ agentId: input.agentId }, { agentId: null }] },
      include: { conditions: true },
    }),
  ]);

  const permission = resolveBestPermission(permissions, evaluationInput);
  const matchedPolicies = filterApplicablePolicies(candidatePolicies, evaluationInput);
  const resolved = resolveDecision(permission, matchedPolicies, evaluationInput);
  const traceId = randomUUID();
  const context =
    input.context && Object.keys(input.context).length > 0 ? input.context : undefined;

  const approvalRequestId = await prisma.$transaction(async (tx) => {
    const activityEvent = await tx.activityEvent.create({
      data: {
        organizationId,
        agentId: input.agentId,
        eventType: "ACTION",
        action: input.action,
        resource: input.resource,
        status: resolved.decision === "ALLOW" ? "ALLOWED" : resolved.decision === "BLOCK" ? "BLOCKED" : "APPROVAL_REQUIRED",
        riskLevel: input.riskLevel ?? agent.riskLevel,
        traceId,
        metadata: context,
      },
    });

    const policyEvaluation = await tx.policyEvaluation.create({
      data: {
        organizationId,
        agentId: input.agentId,
        action: input.action,
        resource: input.resource,
        environment: input.environment,
        tool: input.tool,
        riskLevel: input.riskLevel,
        context,
        decision: resolved.decision,
        reason: resolved.reason,
        permissionId: resolved.matchedPermissionSnapshot?.id,
        permissionSnapshot: resolved.matchedPermissionSnapshot,
        matchedPolicyIds: resolved.matchedPolicySnapshots.map((p) => p.id),
        matchedPolicySnapshots: resolved.matchedPolicySnapshots,
        traceId,
        activityEventId: activityEvent.id,
      },
    });

    if (resolved.decision !== "REQUIRE_APPROVAL") return undefined;

    const approval = await tx.approvalRequest.create({
      data: {
        organizationId,
        agentId: input.agentId,
        policyEvaluationId: policyEvaluation.id,
        action: input.action,
        resource: input.resource,
        environment: input.environment,
        tool: input.tool,
        riskLevel: input.riskLevel ?? agent.riskLevel,
        context,
        reason: resolved.reason,
        traceId,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId,
        actorType: "SYSTEM",
        agentId: input.agentId,
        eventType: "approval.requested",
        entityType: "ApprovalRequest",
        entityId: approval.id,
        action: input.action,
        metadata: { reason: resolved.reason },
        traceId,
      },
    });

    return approval.id;
  });

  return { decision: resolved.decision, approvalRequestId };
}

/** Mirrors lib/approvals/service.ts's resolveApproval() with raw prisma calls, for the same server-only reason. */
async function resolveSeedApproval(
  organizationId: string,
  approvalRequestId: string,
  decidedByUserId: string,
  resolution: SeedResolution
) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: resolution.decision, resolvedAt: new Date() },
    });

    await tx.approvalDecision.create({
      data: {
        organizationId,
        approvalRequestId,
        decidedByUserId,
        decision: resolution.decision,
        comment: resolution.comment,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId,
        actorType: "USER",
        actorUserId: decidedByUserId,
        agentId: request.agentId,
        eventType: resolution.decision === "APPROVED" ? "approval.approved" : "approval.rejected",
        entityType: "ApprovalRequest",
        entityId: request.id,
        action: request.action,
        metadata: { comment: resolution.comment },
        traceId: request.traceId,
      },
    });

    await tx.activityEvent.create({
      data: {
        organizationId,
        agentId: request.agentId,
        eventType: "SYSTEM",
        action: resolution.decision === "APPROVED" ? "approval.approve" : "approval.reject",
        resource: request.resource,
        status: resolution.decision === "APPROVED" ? "ALLOWED" : "BLOCKED",
        riskLevel: request.riskLevel ?? "LOW",
        traceId: request.traceId,
        metadata: { comment: resolution.comment, approvalRequestId: request.id },
      },
    });
  });
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Two realistic Security Alert scenarios (spec §50), computed with the
 * real pure detector functions from lib/security/detectors.ts — same
 * "not hand-faked" principle as the policy engine and approval scenarios
 * above — rather than hand-writing alert text.
 *
 * Cost spike: backdates 7 days of a ~$12/day baseline for Research Agent,
 * then adds a "repeated execution loop" spike of ~$94 today, so the
 * seeded data and the detector's own math agree exactly (whoever loads
 * the demo sees the same numbers the detector computed).
 *
 * New sensitive action: Sales Agent's crm.export baseline permission is
 * BLOCK — a first-ever attempt at a HIGH-risk blocked action is exactly
 * the CRITICAL-severity case from docs/security-intelligence.md's
 * severity table.
 */
async function seedSecurityAlerts(
  organizationId: string,
  agentIdByName: Map<string, string>,
  resolverUserId: string
) {
  const researchId = agentIdByName.get("Research Agent")!;
  const salesId = agentIdByName.get("Sales Agent")!;

  const todayStart = startOfUtcDay(new Date());
  const baselineDailyCents = 1200; // $12/day
  const spikeCents = 9400; // $94 today

  const baselineEvents = [];
  for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
    const dayStart = new Date(todayStart.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    // Two events per day summing to the baseline, spread across the day.
    baselineEvents.push(
      {
        organizationId,
        agentId: researchId,
        timestamp: new Date(dayStart.getTime() + 10 * 60 * 60 * 1000),
        eventType: "MODEL_CALL" as const,
        action: "summarize_document",
        resource: `file:${randomUUID().slice(0, 8)}.pdf`,
        status: "ALLOWED" as const,
        riskLevel: "LOW" as const,
        durationMs: randomInt(900, 2600),
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-4.5",
        costCents: Math.round(baselineDailyCents * 0.6),
        traceId: randomUUID(),
      },
      {
        organizationId,
        agentId: researchId,
        timestamp: new Date(dayStart.getTime() + 15 * 60 * 60 * 1000),
        eventType: "MODEL_CALL" as const,
        action: "summarize_document",
        resource: `file:${randomUUID().slice(0, 8)}.pdf`,
        status: "ALLOWED" as const,
        riskLevel: "LOW" as const,
        durationMs: randomInt(900, 2600),
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-4.5",
        costCents: Math.round(baselineDailyCents * 0.4),
        traceId: randomUUID(),
      }
    );
  }
  await prisma.activityEvent.createMany({ data: baselineEvents });

  // Today: a repeated execution loop — many small identical calls instead of a few large ones.
  const spikeEventCount = 18;
  const spikeCostPerEvent = Math.round(spikeCents / spikeEventCount);
  const spikeTraceId = randomUUID();
  const spikeEvents = Array.from({ length: spikeEventCount }, (_, i) => ({
    organizationId,
    agentId: researchId,
    timestamp: new Date(todayStart.getTime() + (i + 1) * 5 * 60 * 1000),
    eventType: "MODEL_CALL" as const,
    action: "summarize_document",
    resource: "file:quarterly-report.pdf",
    status: "ALLOWED" as const,
    riskLevel: "LOW" as const,
    durationMs: randomInt(900, 2600),
    modelProvider: "Anthropic",
    modelName: "claude-sonnet-4.5",
    costCents: spikeCostPerEvent,
    traceId: spikeTraceId,
  }));
  await prisma.activityEvent.createMany({ data: spikeEvents });

  const costFinding = detectCostSpike({
    agentId: researchId,
    agentName: "Research Agent",
    todaySpendCents: spikeEventCount * spikeCostPerEvent,
    trailingDailyAverageCents: baselineDailyCents,
  });

  if (costFinding) {
    const alert = await prisma.securityAlert.create({
      data: {
        organizationId,
        agentId: costFinding.agentId,
        type: costFinding.type,
        severity: costFinding.severity,
        title: costFinding.title,
        description: costFinding.description,
        evidence: costFinding.evidence as never,
        traceId: spikeTraceId,
      },
    });
    await prisma.auditEvent.create({
      data: {
        organizationId,
        actorType: "SYSTEM",
        agentId: costFinding.agentId,
        eventType: "security_alert.created",
        entityType: "SecurityAlert",
        entityId: alert.id,
        action: costFinding.type,
        metadata: { severity: costFinding.severity, title: costFinding.title },
        traceId: spikeTraceId,
      },
    });
  }

  // A first-ever, HIGH-risk, blocked crm.export attempt for Sales Agent.
  const exportTraceId = randomUUID();
  const exportEvent = await prisma.activityEvent.create({
    data: {
      organizationId,
      agentId: salesId,
      timestamp: new Date(),
      eventType: "DATA_ACCESS",
      action: "crm.export",
      resource: "export:all-contacts",
      status: "BLOCKED",
      riskLevel: "HIGH",
      traceId: exportTraceId,
    },
  });

  const sensitiveActionFinding = detectNewSensitiveAction({
    agentId: salesId,
    agentName: "Sales Agent",
    action: "crm.export",
    riskLevel: "HIGH",
    status: "BLOCKED",
    traceId: exportTraceId,
    hasPriorHistory: false,
  });

  if (sensitiveActionFinding) {
    const alert = await prisma.securityAlert.create({
      data: {
        organizationId,
        agentId: sensitiveActionFinding.agentId,
        type: sensitiveActionFinding.type,
        severity: sensitiveActionFinding.severity,
        title: sensitiveActionFinding.title,
        description: sensitiveActionFinding.description,
        evidence: sensitiveActionFinding.evidence as never,
        traceId: exportTraceId,
      },
    });
    await prisma.auditEvent.create({
      data: {
        organizationId,
        actorType: "SYSTEM",
        agentId: sensitiveActionFinding.agentId,
        eventType: "security_alert.created",
        entityType: "SecurityAlert",
        entityId: alert.id,
        action: sensitiveActionFinding.type,
        metadata: { severity: sensitiveActionFinding.severity, title: sensitiveActionFinding.title },
        traceId: exportTraceId,
      },
    });

    // Acknowledged, not resolved — demonstrates the in-progress state, not just OPEN/RESOLVED.
    await prisma.securityAlert.update({
      where: { id: alert.id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedByUserId: resolverUserId },
    });
    await prisma.auditEvent.create({
      data: {
        organizationId,
        actorType: "USER",
        actorUserId: resolverUserId,
        agentId: sensitiveActionFinding.agentId,
        eventType: "security_alert.acknowledged",
        entityType: "SecurityAlert",
        entityId: alert.id,
        action: sensitiveActionFinding.type,
      },
    });
  }

  console.log(`  Security alerts: seeded cost spike (Research Agent) and new sensitive action (Sales Agent, ${exportEvent.action})`);
}

async function main() {
  console.log("Seeding Aegis demo data…");

  const passwordHash = await bcrypt.hash("aegis-demo-2026", 12);

  const user = await prisma.user.upsert({
    where: { email: "demo@northstarlabs.io" },
    update: {},
    create: {
      name: "Jordan Reyes",
      email: "demo@northstarlabs.io",
      passwordHash,
    },
  });

  // The demo org's approver — referenced in decisions/comments below so
  // Approvals and Audit read like a real team made these calls, not a
  // faceless system.
  const approver = await prisma.user.upsert({
    where: { email: "sarah.chen@northstarlabs.io" },
    update: {},
    create: {
      name: "Sarah Chen",
      email: "sarah.chen@northstarlabs.io",
      passwordHash,
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "northstar-labs" },
    update: {},
    create: {
      name: "Northstar Labs",
      slug: "northstar-labs",
      plan: "growth",
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: {},
    create: { organizationId: organization.id, userId: user.id, role: "OWNER" },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: approver.id } },
    update: {},
    create: { organizationId: organization.id, userId: approver.id, role: "ADMIN" },
  });

  // Role examples (spec §50/§17-18) — demonstrate the expanded Phase 5
  // RBAC beyond OWNER/ADMIN.
  const securityReviewer = await prisma.user.upsert({
    where: { email: "priya.patel@northstarlabs.io" },
    update: {},
    create: { name: "Priya Patel", email: "priya.patel@northstarlabs.io", passwordHash },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: securityReviewer.id } },
    update: {},
    create: { organizationId: organization.id, userId: securityReviewer.id, role: "SECURITY" },
  });

  const financeViewer = await prisma.user.upsert({
    where: { email: "marcus.webb@northstarlabs.io" },
    update: {},
    create: { name: "Marcus Webb", email: "marcus.webb@northstarlabs.io", passwordHash },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: financeViewer.id } },
    update: {},
    create: { organizationId: organization.id, userId: financeViewer.id, role: "FINANCE" },
  });

  // Clear previously seeded domain data for this org so the script is re-runnable.
  // AuditEvent has no cascade path from Agent/PolicyEvaluation, so it needs an
  // explicit delete; ApprovalRequest/ApprovalDecision cascade from PolicyEvaluation
  // and ApprovalRequest respectively via onDelete: Cascade at the database level.
  // SecurityAlert has no cascade path either; Agent.teamId is SetNull on Team
  // delete, so teams must be cleared after agents (or the FK would dangle) —
  // deleting agents first, then teams, keeps this simple.
  await prisma.securityAlert.deleteMany({ where: { organizationId: organization.id } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: organization.id } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: organization.id } });
  await prisma.policy.deleteMany({ where: { organizationId: organization.id } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: organization.id } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: organization.id } });
  await prisma.agentTool.deleteMany({ where: { agent: { organizationId: organization.id } } });
  await prisma.agent.deleteMany({ where: { organizationId: organization.id } });
  await prisma.team.deleteMany({ where: { organizationId: organization.id } });

  const teamIdByName = new Map<string, string>();
  for (const teamName of TEAMS) {
    const team = await prisma.team.create({ data: { organizationId: organization.id, name: teamName } });
    teamIdByName.set(teamName, team.id);
  }
  console.log(`  Teams: created ${TEAMS.length} teams`);

  const agentIdByName = new Map<string, string>();

  for (const seed of AGENTS) {
    const agent = await prisma.agent.create({
      data: {
        organizationId: organization.id,
        name: seed.name,
        slug: seed.name.toLowerCase().replace(/\s+/g, "-"),
        description: seed.description,
        status: seed.status,
        riskLevel: seed.riskLevel,
        environment: seed.environment,
        owner: seed.owner,
        teamId: seed.team ? teamIdByName.get(seed.team) : undefined,
        modelProvider: seed.modelProvider,
        modelName: seed.modelName,
        framework: seed.framework,
        sdkVersion: seed.sdkVersion,
        lastActiveAt: new Date(Date.now() - seed.lastActiveMinutesAgo * 60 * 1000),
        tools: { create: seed.tools },
      },
    });

    agentIdByName.set(seed.name, agent.id);

    if (seed.permissions.length > 0) {
      await prisma.agentPermission.createMany({
        data: seed.permissions.map((p) => ({
          organizationId: organization.id,
          agentId: agent.id,
          action: p.action,
          resource: p.resource ?? "",
          decision: p.decision,
          description: p.description,
        })),
      });
    }

    const events = Array.from({ length: seed.eventCount }, () => {
      const template = pick(seed.actions);
      const status = weightedStatus(template.statusWeights);
      const [costMin, costMax] = template.costCentsRange;
      const [durMin, durMax] = template.durationMsRange;

      return {
        organizationId: organization.id,
        agentId: agent.id,
        timestamp: recentTimestamp(14),
        eventType: template.eventType,
        action: template.action,
        resource: template.resource(),
        status,
        riskLevel: template.riskLevel,
        durationMs: randomInt(durMin, durMax),
        modelProvider: seed.modelProvider,
        modelName: seed.modelName,
        costCents: randomInt(costMin, costMax),
        traceId: randomUUID(),
        errorMessage: status === "FAILED" ? "Tool call timed out after 3 retries." : null,
        metadata: template.metadata ? template.metadata() : undefined,
      };
    }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    await prisma.activityEvent.createMany({ data: events });

    console.log(`  ${seed.name}: created with ${events.length} activity events`);
  }

  await seedSecurityAlerts(organization.id, agentIdByName, securityReviewer.id);

  for (const policySeed of POLICIES) {
    await prisma.policy.create({
      data: {
        organizationId: organization.id,
        name: policySeed.name,
        description: policySeed.description,
        decision: policySeed.decision,
        priority: policySeed.priority,
        agentId: policySeed.agentName ? agentIdByName.get(policySeed.agentName) : null,
        action: policySeed.action,
        environment: policySeed.environment,
        conditions: {
          create: (policySeed.conditions ?? []).map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value as never,
          })),
        },
      },
    });
  }
  console.log(`  Policies: created ${POLICIES.length} policies`);

  const scenarios = buildScenarios(organization.id, agentIdByName);
  let evaluationCount = 0;
  let approvalCount = 0;
  let resolvedCount = 0;
  for (const scenario of scenarios) {
    const { approvalRequestId } = await runSeedEvaluation(organization.id, scenario);
    evaluationCount += 1;

    if (approvalRequestId) {
      approvalCount += 1;
      if (scenario.resolution) {
        await resolveSeedApproval(organization.id, approvalRequestId, approver.id, scenario.resolution);
        resolvedCount += 1;
      }
    }
  }
  console.log(`  Evaluations: ran ${evaluationCount} scenarios through the real policy engine`);
  console.log(
    `  Approvals: created ${approvalCount} approval requests (${resolvedCount} resolved by Sarah Chen, ${approvalCount - resolvedCount} left pending)`
  );

  console.log("\nSeed complete.");
  console.log("  Organization: Northstar Labs (northstar-labs)");
  console.log("  Sign in as owner (OWNER):             demo@northstarlabs.io / aegis-demo-2026");
  console.log("  Sign in as approver (ADMIN):          sarah.chen@northstarlabs.io / aegis-demo-2026");
  console.log("  Sign in as security reviewer (SECURITY): priya.patel@northstarlabs.io / aegis-demo-2026");
  console.log("  Sign in as finance viewer (FINANCE):  marcus.webb@northstarlabs.io / aegis-demo-2026");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
