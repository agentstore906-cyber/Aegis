import type { DemoAgent, DemoAlert, DemoRun, DemoActivityItem } from "./types";

const NOW = Date.now();
function minutesAgo(n: number): string {
  return new Date(NOW - n * 60_000).toISOString();
}
function hoursAgo(n: number): string {
  return new Date(NOW - n * 60 * 60_000).toISOString();
}
function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60_000).toISOString();
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "customer-support-agent",
    name: "Customer Support Agent",
    role: "Handles inbound support tickets and drafts replies",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 3102,
    costCents: 1820,
    successRate: 98.4,
    avgLatencyMs: 820,
    tokenUsage: 1_082_400,
    lastActiveAt: minutesAgo(2),
  },
  {
    id: "sales-research-agent",
    name: "Sales Research Agent",
    role: "Researches prospects and enriches CRM records",
    status: "active",
    model: "gpt-4.1",
    runs: 1845,
    costCents: 3460,
    successRate: 94.2,
    avgLatencyMs: 2400,
    tokenUsage: 1_664_900,
    lastActiveAt: minutesAgo(1),
  },
  {
    id: "coding-agent",
    name: "Coding Agent",
    role: "Writes patches and runs test suites in CI",
    status: "active",
    model: "gpt-4.1",
    runs: 1240,
    costCents: 2890,
    successRate: 91.7,
    avgLatencyMs: 4100,
    tokenUsage: 2_731_600,
    lastActiveAt: minutesAgo(8),
  },
  {
    id: "data-analyst-agent",
    name: "Data Analyst",
    role: "Builds reports and answers ad hoc data questions",
    status: "active",
    model: "gpt-4.1",
    runs: 890,
    costCents: 3110,
    successRate: 88.5,
    avgLatencyMs: 3200,
    tokenUsage: 1_598_300,
    lastActiveAt: minutesAgo(14),
  },
  {
    id: "content-agent",
    name: "Content Agent",
    role: "Drafts marketing copy and blog outlines",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 610,
    costCents: 980,
    successRate: 99.1,
    avgLatencyMs: 1900,
    tokenUsage: 673_800,
    lastActiveAt: hoursAgo(3),
  },
  {
    id: "onboarding-agent",
    name: "Onboarding Agent",
    role: "Walks new customers through initial setup",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 210,
    costCents: 150,
    successRate: 97.0,
    avgLatencyMs: 650,
    tokenUsage: 84_000,
    lastActiveAt: hoursAgo(5),
  },
  {
    id: "billing-agent",
    name: "Billing Agent",
    role: "Answers billing questions and sends reminders",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 180,
    costCents: 120,
    successRate: 99.5,
    avgLatencyMs: 300,
    tokenUsage: 42_500,
    lastActiveAt: hoursAgo(6),
  },
  {
    id: "qa-agent",
    name: "QA Agent",
    role: "Runs regression checks against staging",
    status: "paused",
    model: "gpt-4.1",
    runs: 140,
    costCents: 90,
    successRate: 93.0,
    avgLatencyMs: 1500,
    tokenUsage: 168_200,
    lastActiveAt: daysAgo(2),
  },
  {
    id: "recruiting-agent",
    name: "Recruiting Agent",
    role: "Screens resumes and schedules interviews",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 90,
    costCents: 60,
    successRate: 96.0,
    avgLatencyMs: 900,
    tokenUsage: 61_000,
    lastActiveAt: hoursAgo(9),
  },
  {
    id: "marketing-agent",
    name: "Marketing Agent",
    role: "Plans social posts and campaign copy",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 60,
    costCents: 40,
    successRate: 98.0,
    avgLatencyMs: 1100,
    tokenUsage: 38_700,
    lastActiveAt: daysAgo(1),
  },
  {
    id: "inventory-agent",
    name: "Inventory Agent",
    role: "Flags low-stock SKUs and drafts reorder requests",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 34,
    costCents: 15,
    successRate: 100.0,
    avgLatencyMs: 400,
    tokenUsage: 9_800,
    lastActiveAt: daysAgo(3),
  },
  {
    id: "scheduling-agent",
    name: "Scheduling Agent",
    role: "Coordinates meeting times across calendars",
    status: "active",
    model: "gpt-4.1-mini",
    runs: 20,
    costCents: 5,
    successRate: 100.0,
    avgLatencyMs: 250,
    tokenUsage: 4_200,
    lastActiveAt: daysAgo(4),
  },
];

export const DEMO_RUNS: DemoRun[] = [
  // Customer Support Agent
  {
    id: "run-csa-1",
    agentId: "customer-support-agent",
    startedAt: minutesAgo(2),
    status: "success",
    durationMs: 3560,
    totalTokens: 410,
    costCents: 6,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by new ticket #48213", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read ticket #48213 (Zendesk)", status: "success", durationMs: 320 },
      { id: "s3", kind: "api", label: "API request", detail: "GET zendesk.com/api/v2/tickets/48213", status: "success", durationMs: 280 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafted reply", status: "success", durationMs: 1900, tokens: 410, costCents: 6 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Send reply via Zendesk", status: "success", durationMs: 540 },
      { id: "s6", kind: "end", label: "Completed", detail: "Ticket replied and tagged ‘resolved’", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-csa-2",
    agentId: "customer-support-agent",
    startedAt: minutesAgo(41),
    status: "failed",
    durationMs: 2350,
    totalTokens: 380,
    costCents: 5,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by new ticket #48198", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read ticket #48198 (Zendesk)", status: "success", durationMs: 300 },
      { id: "s3", kind: "api", label: "API request", detail: "GET zendesk.com/api/v2/tickets/48198", status: "success", durationMs: 260 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafted reply", status: "success", durationMs: 1600, tokens: 380, costCents: 5 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Send reply via Zendesk", status: "failed", durationMs: 190 },
      { id: "s6", kind: "end", label: "Failed", detail: "Zendesk API returned 429 — reply not sent", status: "failed", durationMs: 0 },
    ],
  },

  // Sales Research Agent
  {
    id: "run-sra-1",
    agentId: "sales-research-agent",
    startedAt: minutesAgo(1),
    status: "success",
    durationMs: 4230,
    totalTokens: 920,
    costCents: 14,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by new lead: Initech Inc.", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Search company (Clearbit)", status: "success", durationMs: 640 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.clearbit.com/v2/companies/find", status: "success", durationMs: 410 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · summarized company profile", status: "success", durationMs: 2800, tokens: 920, costCents: 14 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Write summary to CRM record", status: "success", durationMs: 380 },
      { id: "s6", kind: "end", label: "Completed", detail: "Lead enriched and assigned to AE", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-sra-2",
    agentId: "sales-research-agent",
    startedAt: minutesAgo(6),
    status: "failed",
    durationMs: 29_920,
    totalTokens: 0,
    costCents: 2,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by bulk lead import (312 rows)", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Search company (Clearbit) — repeated 47× in 30s", status: "failed", durationMs: 29_800 },
      { id: "s3", kind: "api", label: "API request", detail: "Clearbit rate limit exceeded (429)", status: "failed", durationMs: 120 },
      { id: "s4", kind: "end", label: "Failed", detail: "Stopped after triggering rate-limit protection — flagged by Aegis", status: "failed", durationMs: 0 },
    ],
  },

  // Coding Agent
  {
    id: "run-ca-1",
    agentId: "coding-agent",
    startedAt: minutesAgo(8),
    status: "success",
    durationMs: 14_350,
    totalTokens: 2100,
    costCents: 32,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by GitHub issue #482: ‘Fix null pointer in checkout’", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read file (checkout/cart.ts)", status: "success", durationMs: 210 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.github.com/repos/.../checkout/cart.ts", status: "success", durationMs: 340 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · generated patch", status: "success", durationMs: 5200, tokens: 2100, costCents: 32 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Run test suite (142 tests)", status: "success", durationMs: 8600 },
      { id: "s6", kind: "end", label: "Completed", detail: "Opened PR #483 — all tests passing", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-ca-2",
    agentId: "coding-agent",
    startedAt: hoursAgo(3),
    status: "failed",
    durationMs: 11_500,
    totalTokens: 1850,
    costCents: 28,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by GitHub issue #479: ‘Add retry to webhook sender’", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read file (lib/webhooks/dispatch.ts)", status: "success", durationMs: 190 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.github.com/.../dispatch.ts", status: "success", durationMs: 310 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · generated patch", status: "success", durationMs: 4800, tokens: 1850, costCents: 28 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Run test suite (142 tests) — 3 failing", status: "failed", durationMs: 6200 },
      { id: "s6", kind: "end", label: "Failed", detail: "Left in draft — tests failing, needs review", status: "failed", durationMs: 0 },
    ],
  },

  // Data Analyst
  {
    id: "run-da-1",
    agentId: "data-analyst-agent",
    startedAt: hoursAgo(20),
    status: "success",
    durationMs: 5040,
    totalTokens: 780,
    costCents: 12,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by scheduled weekly report", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Query warehouse (Snowflake)", status: "success", durationMs: 1200 },
      { id: "s3", kind: "api", label: "API request", detail: "POST internal query endpoint", status: "success", durationMs: 900 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · summarized results", status: "success", durationMs: 2600, tokens: 780, costCents: 12 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Post summary to Slack #reports", status: "success", durationMs: 340 },
      { id: "s6", kind: "end", label: "Completed", detail: "Weekly report posted", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-da-2",
    agentId: "data-analyst-agent",
    startedAt: minutesAgo(14),
    status: "success",
    durationMs: 20_200,
    totalTokens: 8200,
    costCents: 118,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by ad hoc question: ‘full-year cohort analysis’", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Query warehouse (Snowflake) — large scan", status: "success", durationMs: 4800 },
      { id: "s3", kind: "api", label: "API request", detail: "POST internal query endpoint", status: "success", durationMs: 2100 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · analyzed 340K rows across 3 passes", status: "success", durationMs: 12_400, tokens: 8200, costCents: 118 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Generate chart set", status: "success", durationMs: 900 },
      { id: "s6", kind: "end", label: "Completed", detail: "Report delivered — flagged by Aegis for cost review", status: "success", durationMs: 0 },
    ],
  },

  // Content Agent
  {
    id: "run-cta-1",
    agentId: "content-agent",
    startedAt: hoursAgo(3),
    status: "success",
    durationMs: 2770,
    totalTokens: 640,
    costCents: 9,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by content calendar: ‘Q3 product update blog’", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read brief (Notion)", status: "success", durationMs: 260 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.notion.com/v1/pages/...", status: "success", durationMs: 190 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafted 800-word outline", status: "success", durationMs: 2100, tokens: 640, costCents: 9 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Save draft to Notion", status: "success", durationMs: 220 },
      { id: "s6", kind: "end", label: "Completed", detail: "Draft ready for review", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-cta-2",
    agentId: "content-agent",
    startedAt: minutesAgo(3),
    status: "running",
    durationMs: 420,
    totalTokens: 0,
    costCents: 0,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by content calendar: ‘Customer story — Northstar Labs’", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read brief (Notion)", status: "success", durationMs: 240 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.notion.com/v1/pages/...", status: "success", durationMs: 180 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafting outline…", status: "pending", durationMs: 0 },
    ],
  },

  // Lighter agents — one run each
  {
    id: "run-oa-1",
    agentId: "onboarding-agent",
    startedAt: hoursAgo(5),
    status: "success",
    durationMs: 1430,
    totalTokens: 260,
    costCents: 4,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by new signup: Lumen Systems", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Create workspace", status: "success", durationMs: 180 },
      { id: "s3", kind: "api", label: "API request", detail: "POST /api/v1/organizations", status: "success", durationMs: 140 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · personalized welcome email", status: "success", durationMs: 900, tokens: 260, costCents: 4 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Send welcome email", status: "success", durationMs: 210 },
      { id: "s6", kind: "end", label: "Completed", detail: "Onboarding sequence started", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-ba-1",
    agentId: "billing-agent",
    startedAt: hoursAgo(6),
    status: "success",
    durationMs: 1020,
    totalTokens: 140,
    costCents: 2,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by invoice due reminder", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Look up account (Stripe)", status: "success", durationMs: 160 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.stripe.com/v1/customers/...", status: "success", durationMs: 140 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafted reminder", status: "success", durationMs: 600, tokens: 140, costCents: 2 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Send email via Postmark", status: "success", durationMs: 120 },
      { id: "s6", kind: "end", label: "Completed", detail: "Reminder sent", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-qa-1",
    agentId: "qa-agent",
    startedAt: daysAgo(2),
    status: "failed",
    durationMs: 11_660,
    totalTokens: 540,
    costCents: 9,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by nightly regression suite", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Checkout staging branch", status: "success", durationMs: 400 },
      { id: "s3", kind: "api", label: "API request", detail: "POST ci.internal/staging/run", status: "success", durationMs: 260 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1 · triaged failures", status: "success", durationMs: 1800, tokens: 540, costCents: 9 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Run regression suite (612 tests) — 38 failing", status: "failed", durationMs: 9200 },
      { id: "s6", kind: "end", label: "Failed", detail: "Run aborted — paused pending investigation", status: "failed", durationMs: 0 },
    ],
  },
  {
    id: "run-ra-1",
    agentId: "recruiting-agent",
    startedAt: hoursAgo(9),
    status: "success",
    durationMs: 1650,
    totalTokens: 310,
    costCents: 4,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by new application: Backend Engineer", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read resume (Greenhouse)", status: "success", durationMs: 220 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.greenhouse.io/v1/candidates/...", status: "success", durationMs: 180 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · screened against rubric", status: "success", durationMs: 950, tokens: 310, costCents: 4 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Schedule interview (Calendly)", status: "success", durationMs: 300 },
      { id: "s6", kind: "end", label: "Completed", detail: "Interview scheduled with hiring manager", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-ma-1",
    agentId: "marketing-agent",
    startedAt: daysAgo(1),
    status: "success",
    durationMs: 1780,
    totalTokens: 410,
    costCents: 5,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by content calendar: weekly social post", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Read campaign brief (Notion)", status: "success", durationMs: 200 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.notion.com/v1/pages/...", status: "success", durationMs: 160 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · drafted 3 post variants", status: "success", durationMs: 1100, tokens: 410, costCents: 5 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Save drafts to queue", status: "success", durationMs: 320 },
      { id: "s6", kind: "end", label: "Completed", detail: "3 drafts queued for approval", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-ia-1",
    agentId: "inventory-agent",
    startedAt: daysAgo(3),
    status: "success",
    durationMs: 940,
    totalTokens: 180,
    costCents: 2,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by nightly stock sync", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Query stock levels (NetSuite)", status: "success", durationMs: 210 },
      { id: "s3", kind: "api", label: "API request", detail: "GET api.netsuite.com/v1/inventory", status: "success", durationMs: 170 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · flagged 4 low-stock SKUs", status: "success", durationMs: 400, tokens: 180, costCents: 2 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Draft reorder request", status: "success", durationMs: 160 },
      { id: "s6", kind: "end", label: "Completed", detail: "Reorder request sent for review", status: "success", durationMs: 0 },
    ],
  },
  {
    id: "run-sc-1",
    agentId: "scheduling-agent",
    startedAt: daysAgo(4),
    status: "success",
    durationMs: 640,
    totalTokens: 90,
    costCents: 1,
    steps: [
      { id: "s1", kind: "start", label: "Agent started", detail: "Triggered by meeting request: Q3 planning sync", status: "success", durationMs: 0 },
      { id: "s2", kind: "tool", label: "Tool call", detail: "Check calendars (Google Calendar)", status: "success", durationMs: 180 },
      { id: "s3", kind: "api", label: "API request", detail: "GET calendar.googleapis.com/v3/freebusy", status: "success", durationMs: 140 },
      { id: "s4", kind: "model", label: "Model execution", detail: "gpt-4.1-mini · picked best overlapping slot", status: "success", durationMs: 220, tokens: 90, costCents: 1 },
      { id: "s5", kind: "tool", label: "Tool call", detail: "Send invite", status: "success", durationMs: 100 },
      { id: "s6", kind: "end", label: "Completed", detail: "Meeting scheduled for Thursday, 2pm", status: "success", durationMs: 0 },
    ],
  },
];

export const DEMO_ALERTS: DemoAlert[] = [
  {
    id: "alert-1",
    agentId: "sales-research-agent",
    severity: "critical",
    status: "open",
    title: "Unusual activity detected",
    description:
      "Sales Research Agent made 47 tool calls in 30 seconds — far above its typical pace of 2–3 calls per minute. Aegis paused further calls and flagged this run for review.",
    evidence: [
      { label: "Tool calls", value: "47 in 30s" },
      { label: "Normal pace", value: "~3 per minute" },
      { label: "Related run", value: "run-sra-2" },
    ],
    detectedAt: minutesAgo(6),
    action: "pause",
  },
  {
    id: "alert-2",
    agentId: "data-analyst-agent",
    severity: "high",
    status: "open",
    title: "Cost spike detected",
    description:
      "Data Analyst's spend is running well above its recent baseline — a single ad hoc query drove an estimated cost spike of +380% versus its daily average.",
    evidence: [
      { label: "Daily average", value: "$0.31/day" },
      { label: "Today", value: "+380% vs. average" },
      { label: "Likely contributor", value: "Large warehouse scan (340K rows)" },
    ],
    detectedAt: hoursAgo(1),
    action: "pause",
  },
  {
    id: "alert-3",
    agentId: "content-agent",
    severity: "medium",
    status: "open",
    title: "First-time use of a sensitive action",
    description:
      "Content Agent published directly to the company blog for the first time — previously it only saved drafts for review.",
    evidence: [
      { label: "Action", value: "blog.publish" },
      { label: "Previous behavior", value: "draft.save only" },
      { label: "Risk", value: "Medium" },
    ],
    detectedAt: hoursAgo(4),
    action: "acknowledge",
  },
];

export function getAgent(agentId: string): DemoAgent | undefined {
  return DEMO_AGENTS.find((agent) => agent.id === agentId);
}

export function getRunsForAgent(agentId: string): DemoRun[] {
  return DEMO_RUNS.filter((run) => run.agentId === agentId).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function getRun(runId: string): DemoRun | undefined {
  return DEMO_RUNS.find((run) => run.id === runId);
}

export const DEMO_ACTIVITY: DemoActivityItem[] = DEMO_RUNS.map((run) => {
  const agent = getAgent(run.agentId)!;
  const lastStep = run.steps[run.steps.length - 1];
  return {
    id: `activity-${run.id}`,
    runId: run.id,
    agentId: run.agentId,
    timestamp: run.startedAt,
    summary: `${agent.name} · ${lastStep.detail}`,
    status: run.status,
  };
}).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const OVERVIEW_STATS = {
  agents: 12,
  runs: 8421,
  costCents: 12_740,
  alerts: 3,
};
