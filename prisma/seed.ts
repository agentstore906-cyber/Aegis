import { PrismaClient, type ActivityStatus, type ActivityType, type RiskLevel } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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

type AgentSeed = {
  name: string;
  owner: string;
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
  lastActiveMinutesAgo: number;
  eventCount: number;
};

const AGENTS: AgentSeed[] = [
  {
    name: "Sales Agent",
    owner: "Revenue",
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
    environment: "PRODUCTION",
    status: "ACTIVE",
    riskLevel: "LOW",
    modelProvider: "Anthropic",
    modelName: "claude-sonnet-4.5",
    framework: "custom",
    sdkVersion: "0.4.2",
    description: "Triages inbound support tickets and drafts customer replies.",
    tools: [{ name: "Zendesk", category: "Communication" }],
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
    environment: "PRODUCTION",
    status: "ACTIVE",
    riskLevel: "HIGH",
    modelProvider: "OpenAI",
    modelName: "gpt-4.1",
    framework: "custom",
    sdkVersion: "0.3.9",
    description: "Reviews billing anomalies and processes customer refund requests.",
    tools: [{ name: "Billing", category: "Financial" }],
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

  // Clear previously seeded domain data for this org so the script is re-runnable.
  await prisma.activityEvent.deleteMany({ where: { organizationId: organization.id } });
  await prisma.agentTool.deleteMany({ where: { agent: { organizationId: organization.id } } });
  await prisma.agent.deleteMany({ where: { organizationId: organization.id } });

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
        modelProvider: seed.modelProvider,
        modelName: seed.modelName,
        framework: seed.framework,
        sdkVersion: seed.sdkVersion,
        lastActiveAt: new Date(Date.now() - seed.lastActiveMinutesAgo * 60 * 1000),
        tools: { create: seed.tools },
      },
    });

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

  console.log("\nSeed complete.");
  console.log("  Organization: Northstar Labs (northstar-labs)");
  console.log("  Sign in with: demo@northstarlabs.io / aegis-demo-2026");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
