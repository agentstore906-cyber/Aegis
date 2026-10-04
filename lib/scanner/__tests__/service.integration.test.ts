/**
 * Integration test (needs DATABASE_URL_TEST): scan persistence, anonymous ownership, claiming after
 * sign-up, publishing, expiry and data minimisation against a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { attributeToScanner } from "@/lib/scanner/analytics";
import {
  claimScansForSession,
  createScan,
  getOrganizationScan,
  getPublicReportBySlug,
  getScanForViewer,
  linkScanToAgent,
  listOrganizationScans,
  setScanPublic,
} from "@/lib/scanner/service";
import type { ScanInput } from "@/lib/scanner/types";

const RUN = `scan_${Date.now()}`;
const SESSION_A = `${RUN}_session_a`;
const SESSION_B = `${RUN}_session_b`;
const CANARY_PROMPT = "CANARY_PRIVATE_SYSTEM_PROMPT_7c1e";
const CANARY_SECRET = "sk-live-abcdefghijklmnopqrstuvwxyz0123456789";

const input = (over: Partial<ScanInput> = {}): ScanInput => ({
  agentType: "support",
  agentLabel: null,
  capabilities: ["customer_data", "send_emails", "credentials_secrets"],
  autonomy: ["autonomous"],
  controls: { audit_logs: "in_place" },
  advancedText: null,
  ...over,
});

let org: { id: string };
let otherOrg: { id: string };
let user: { id: string; createdAt: Date };
let agent: { id: string };
const createdScanIds: string[] = [];

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Scan Org", slug: `${RUN}-org`, plan: "enterprise" } });
  otherOrg = await prisma.organization.create({ data: { name: "Other Org", slug: `${RUN}-other`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { name: "Scanner", email: `${RUN}@example.com` } });
  agent = await prisma.agent.create({ data: { organizationId: org.id, name: "A", slug: "a", owner: "T", modelProvider: "x", modelName: "y" } });
});

afterAll(async () => {
  await prisma.scannerAnalyticsEvent.deleteMany({ where: { OR: [{ organizationId: { in: [org.id, otherOrg.id] } }, { scanId: { in: createdScanIds } }] } });
  await prisma.riskScan.deleteMany({ where: { id: { in: createdScanIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
});

async function scan(sessionHash: string | null, over: Partial<ScanInput> = {}, extra: { userId?: string; organizationId?: string } = {}) {
  const created = await createScan({ input: input(over), sessionHash, ...extra });
  createdScanIds.push(created.id);
  return created;
}

describe("anonymous scans", () => {
  it("persists a deterministic result with a 30-day expiry and an unguessable id, and needs no account", async () => {
    const { id, result } = await scan(SESSION_A);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const row = await prisma.riskScan.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBeNull();
    expect(row.organizationId).toBeNull();
    expect(row.score).toBe(result.score);
    expect(row.highRiskCount).toBe(result.counts.high);
    const days = (row.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
    // The session token itself is never stored — only its hash, as given.
    expect(row.sessionHash).toBe(SESSION_A);
  });

  it("applies data minimisation: pasted text, secrets and the raw prompt are never stored", async () => {
    const { id } = await scan(SESSION_A, { advancedText: `You are the payroll bot. ${CANARY_PROMPT}\nOPENAI_API_KEY="${CANARY_SECRET}"\nUse bash.` });
    const row = await prisma.riskScan.findUniqueOrThrow({ where: { id } });
    const everything = JSON.stringify(row);
    expect(everything).not.toContain(CANARY_PROMPT);
    expect(everything).not.toContain(CANARY_SECRET);
    expect(row.inputSignals).toMatchObject({ chars: expect.any(Number), signals: expect.any(Array) });
    expect(JSON.stringify(row.inputSignals)).toMatch(/secret_/);
    expect(row.result).toBeTruthy();
  });

  it("is viewable by the creating session, and by no other session", async () => {
    const { id } = await scan(SESSION_A);
    expect((await getScanForViewer(id, { sessionHash: SESSION_A })).status).toBe("ok");
    expect((await getScanForViewer(id, { sessionHash: SESSION_B })).status).toBe("not_found");
    expect((await getScanForViewer(id, {})).status).toBe("not_found");
    expect((await getScanForViewer("not-a-valid-id", { sessionHash: SESSION_A })).status).toBe("not_found");
  });

  it("reports an expired scan as expired to its owner, and expired scans cannot be published or claimed", async () => {
    const { id } = await scan(SESSION_A);
    await prisma.riskScan.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getScanForViewer(id, { sessionHash: SESSION_A })).status).toBe("expired");
    expect((await setScanPublic(id, { sessionHash: SESSION_A }, true)).ok).toBe(false);
    const claimed = await claimScansForSession({ sessionHash: SESSION_A, userId: user.id, organizationId: org.id });
    expect(claimed).not.toContain(id);
  });
});

describe("claiming after sign-up", () => {
  it("attaches this browser's unclaimed scans to the account, clears expiry, and is idempotent", async () => {
    const session = `${RUN}_claim`;
    const a = await scan(session);
    const b = await scan(session);
    const claimed = await claimScansForSession({ sessionHash: session, userId: user.id, organizationId: org.id, userCreatedAt: user.createdAt });
    expect(claimed.sort()).toEqual([a.id, b.id].sort());

    const row = await prisma.riskScan.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ userId: user.id, organizationId: org.id });
    expect(row.expiresAt).toBeNull();
    expect(row.claimedAt).not.toBeNull();

    expect(await claimScansForSession({ sessionHash: session, userId: user.id, organizationId: org.id })).toEqual([]);

    const events = await prisma.scannerAnalyticsEvent.findMany({ where: { organizationId: org.id, event: { in: ["scan_claimed", "signup_completed"] } } });
    expect(events.filter((e) => e.event === "scan_claimed").length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.event === "signup_completed")).toBe(true);
  });

  it("does not let a different user claim scans already claimed, and the old session alone no longer reads a claimed scan", async () => {
    const session = `${RUN}_claim2`;
    const s = await scan(session);
    await claimScansForSession({ sessionHash: session, userId: user.id, organizationId: org.id });
    const other = await claimScansForSession({ sessionHash: session, userId: "someone-else", organizationId: otherOrg.id });
    expect(other).toEqual([]);
    expect((await prisma.riskScan.findUniqueOrThrow({ where: { id: s.id } })).organizationId).toBe(org.id);
    expect((await getScanForViewer(s.id, { sessionHash: session })).status).toBe("not_found");
    expect((await getScanForViewer(s.id, { userId: user.id })).status).toBe("ok");
    expect((await getScanForViewer(s.id, { userId: "x", organizationIds: [otherOrg.id] })).status).toBe("not_found");
  });

  it("scans run while signed in belong to the user from the start and never expire", async () => {
    const s = await scan(null, {}, { userId: user.id, organizationId: org.id });
    const row = await prisma.riskScan.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.expiresAt).toBeNull();
    expect(row.claimedAt).not.toBeNull();
  });
});

describe("dashboard queries are tenant-scoped", () => {
  it("lists and reads only the organization's own scans", async () => {
    const mine = await scan(null, {}, { userId: user.id, organizationId: org.id });
    const theirs = await scan(null, {}, { userId: "u2", organizationId: otherOrg.id });
    const list = await listOrganizationScans(org.id);
    expect(list.some((s) => s.id === mine.id)).toBe(true);
    expect(list.some((s) => s.id === theirs.id)).toBe(false);
    expect(await getOrganizationScan(org.id, theirs.id)).toBeNull();
    expect((await getOrganizationScan(org.id, mine.id))?.id).toBe(mine.id);
  });

  it("links a scan only to an agent of the same organization", async () => {
    const mine = await scan(null, {}, { userId: user.id, organizationId: org.id });
    const foreignAgent = await prisma.agent.create({ data: { organizationId: otherOrg.id, name: "F", slug: "f", owner: "T", modelProvider: "x", modelName: "y" } });
    expect(await linkScanToAgent(org.id, mine.id, foreignAgent.id)).toBe(false);
    expect(await linkScanToAgent(org.id, mine.id, agent.id)).toBe(true);
    expect((await prisma.riskScan.findUniqueOrThrow({ where: { id: mine.id } })).connectedAgentId).toBe(agent.id);
    // A different org cannot link someone else's scan.
    expect(await linkScanToAgent(otherOrg.id, mine.id, foreignAgent.id)).toBe(false);
    await prisma.agent.delete({ where: { id: foreignAgent.id } });
  });
});

describe("sharing", () => {
  it("publishes a public-safe projection, keeps the slug stable, and unpublishing kills the link", async () => {
    const s = await scan(SESSION_A, { agentType: "other", agentLabel: "ACME-LABEL-CANARY" });
    expect(await getPublicReportBySlug("AbCdEfGhIjKl")).toBeNull();

    const pub = await setScanPublic(s.id, { sessionHash: SESSION_A }, true);
    expect(pub.ok && pub.slug).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const slug = (pub as { slug: string }).slug;
    const again = await setScanPublic(s.id, { sessionHash: SESSION_A }, true);
    expect(again.ok && again.slug).toBe(slug);

    const report = await getPublicReportBySlug(slug);
    expect(report?.score).toBe(s.result.score);
    expect(JSON.stringify(report)).not.toMatch(/ACME-LABEL-CANARY|sessionHash|organizationId/);

    const row = await prisma.riskScan.findUniqueOrThrow({ where: { id: s.id } });
    const days = (row.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);

    expect((await setScanPublic(s.id, { sessionHash: SESSION_A }, false)).ok).toBe(true);
    expect(await getPublicReportBySlug(slug)).toBeNull();
  });

  it("only the owner may publish", async () => {
    const s = await scan(SESSION_A);
    expect((await setScanPublic(s.id, { sessionHash: SESSION_B }, true)).ok).toBe(false);
    expect((await setScanPublic(s.id, {}, true)).ok).toBe(false);
    expect((await prisma.riskScan.findUniqueOrThrow({ where: { id: s.id } })).isPublic).toBe(false);
  });
});

describe("funnel attribution", () => {
  it("attributes downstream conversion events to the claimed scan, and ignores organizations without one", async () => {
    const noScanOrg = await prisma.organization.create({ data: { name: "No Scan", slug: `${RUN}-noscan` } });
    await attributeToScanner(org.id, "subscription_started");
    await attributeToScanner(noScanOrg.id, "subscription_started");
    const mine = await prisma.scannerAnalyticsEvent.count({ where: { organizationId: org.id, event: "subscription_started" } });
    const theirs = await prisma.scannerAnalyticsEvent.count({ where: { organizationId: noScanOrg.id, event: "subscription_started" } });
    await prisma.organization.delete({ where: { id: noScanOrg.id } });
    expect(mine).toBeGreaterThanOrEqual(1);
    expect(theirs).toBe(0);
  });
});
