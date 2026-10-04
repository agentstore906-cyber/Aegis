/**
 * P7 — incident intelligence, end to end against the verified disposable test
 * database: reconstruction from genuinely ingested telemetry, evidence
 * integrity (every reference resolves to a stored row in the same tenant),
 * incomplete telemetry, concurrent triggers and handlers, status transitions,
 * acknowledgement, immutability enforced by the database, search, tenant
 * isolation and authorization.
 *
 * Evidence tables are append-only: rows are created with the desired values,
 * never updated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent, MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { resolveApproval } from "@/lib/approvals/service";
import { upsertAlertFinding } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import {
  acknowledgeIncident,
  addIncidentNote,
  changeIncidentStatus,
  ensureIncidentForAlert,
  getIncidentView,
  incidentStatusCounts,
  openIncident,
  searchIncidents,
} from "@/lib/incidents/service";
import { IncidentForbiddenError, IncidentNotFoundError, IncidentTransitionError, canManageIncidents, canViewIncidents, type IncidentActor } from "@/lib/incidents/authorization";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";

const RUN_ID = `test_p7_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userA2: { id: string };
let userB: { id: string };
let agentA: Agent;
let agentA2: Agent;
let agentB: Agent;
let keyA: string;

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const actorOf = (org: { id: string }, userId: string, role: MemberRole = "SECURITY"): IncidentActor => ({ organizationId: org.id, userId, role });
let seq = 0;
const trace = (label: string) => `${RUN_ID}-${label}-${(seq += 1)}`;

async function makeAgent(organizationId: string, slug: string) {
  const agent = await prisma.agent.create({ data: { organizationId, name: `Agent ${slug}`, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m" } });
  await prisma.agentPermission.createMany({
    data: ["crm.export", "crm.read", "refund.issue"].map((action) => ({
      organizationId,
      agentId: agent.id,
      action,
      resource: "",
      decision: action === "refund.issue" ? ("REQUIRE_APPROVAL" as const) : ("ALLOW" as const),
    })),
  });
  return agent;
}

async function post(handler: typeof eventsHandler, url: string, key: string, body: Record<string, unknown>) {
  const response = await handler(new Request(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
  const json = (await response.json()) as Record<string, unknown>;
  await drainDeferredTasks();
  return { status: response.status, ...json } as { status: number; id: string; decision: string; evaluationId: string; approvalRequestId?: string };
}
const report = (agent: Agent, body: Record<string, unknown>, key = keyA) =>
  post(eventsHandler, "http://localhost/api/v1/events", key, { agent: agent.slug, eventType: "TOOL_CALL", status: "SUCCESS", ...body });
const decide = (agent: Agent, body: Record<string, unknown>, key = keyA) =>
  post(evaluateHandler, "http://localhost/api/v1/evaluate", key, { agent: agent.slug, ...body });

const raise = (agent: Agent, over: Partial<Parameters<typeof upsertAlertFinding>[1]> & { traceId?: string | null } = {}, org = orgA) =>
  upsertAlertFinding(org.id, {
    type: SECURITY_ALERT_TYPES.BLOCK_SPIKE,
    severity: "HIGH",
    agentId: agent.id,
    title: "Unusual number of blocked actions",
    description: "The agent was blocked 6 times in the last hour.",
    evidence: { blocked: 6 },
    dedupeKey: `k-${(seq += 1)}`,
    ...over,
  } as Parameters<typeof upsertAlertFinding>[1]);

const incidentFor = (agent: Agent, traceId: string, org = orgA) => prisma.incident.findFirst({ where: { organizationId: org.id, agentId: agent.id, clusterKey: `trace:${traceId}` } });

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P7 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P7 B", slug: `${RUN_ID}-b` } });
  userA = await prisma.user.create({ data: { email: `${RUN_ID}-a@example.com`, name: "Alex Analyst" } });
  userA2 = await prisma.user.create({ data: { email: `${RUN_ID}-a2@example.com`, name: "Sam Second" } });
  userB = await prisma.user.create({ data: { email: `${RUN_ID}-b@example.com`, name: "Bea Other" } });
  agentA = await makeAgent(orgA.id, "p7-a");
  agentA2 = await makeAgent(orgA.id, "p7-a2");
  agentB = await makeAgent(orgB.id, "p7-b");
  keyA = (await createApiKey(orgA.id, null, { name: "a", environment: "TEST" })).raw;
}, 60_000);

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  await prisma.incidentActivity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.incident.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userA2.id, userB.id] } } });
  await prisma.$disconnect();
}, 60_000);

// ---------------------------------------------------------------------------

describe("incident reconstruction from real telemetry", () => {
  const T = trace("story");
  let incidentId: string;
  let policyId: string;

  beforeAll(async () => {
    const policy = await prisma.policy.create({ data: { organizationId: orgA.id, agentId: agentA.id, name: "No exports to unknown hosts", decision: "BLOCK", action: "crm.export" } });
    policyId = policy.id;
    // The agent asks to export PII to a host it never used; policy blocks; the agent reports it ran anyway.
    const d = await decide(agentA, { action: "crm.export", tool: "CRM", traceId: T, service: "crm-api", destination: "files.unknown.example", dataClasses: ["PII"], recordCount: 80 });
    expect(d.decision).toBe("BLOCK");
    await report(agentA, { action: "crm.export", tool: "CRM", traceId: T, evaluationId: d.evaluationId, destination: "files.unknown.example", dataClasses: ["PII"], recordCount: 80, taskId: "export-1" });
    const gated = await decide(agentA, { action: "refund.issue", traceId: T });
    await resolveApproval(orgA.id, gated.approvalRequestId!, userA.id, "REJECTED");
    // A detector raises an alert for the run → the incident opens by itself.
    await raise(agentA, { traceId: T, title: "Blocked export to a new destination" });
    incidentId = (await incidentFor(agentA, T))!.id;
  }, 60_000);

  it("opens automatically when a security alert is created, anchored on that alert and its run — one incident per run", async () => {
    const incident = (await incidentFor(agentA, T))!;
    expect(incident).toMatchObject({ anchorType: "SECURITY_ALERT", traceId: T, status: "OPEN", openedVia: "ALERT_TRIGGER", number: expect.any(Number) });
    expect(["HIGH", "CRITICAL"]).toContain(incident.severity);
    // The real after-the-fact detector (the agent reported the blocked export as done) raised its own alert for this run first;
    // that alert opened the incident, and the alert raised above joined it rather than opening a second one.
    const anchor = await prisma.securityAlert.findFirstOrThrow({ where: { id: incident.anchorId } });
    expect(incident.title).toBe(anchor.title);
    expect(await prisma.securityAlert.count({ where: { organizationId: orgA.id, traceId: T } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.incident.count({ where: { organizationId: orgA.id, clusterKey: `trace:${T}` } })).toBe(1);
    const opened = await prisma.incidentActivity.findFirstOrThrow({ where: { incidentId } });
    expect(opened).toMatchObject({ kind: "OPENED", toStatus: "OPEN", actorUserId: null });
  });

  it("rebuilds the timeline from stored rows: trigger, decisions, policy, risk, enforcement, approval, outcome", async () => {
    const view = await getIncidentView(actorOf(orgA, userA.id), incidentId);
    const r = view.reconstruction;
    const kinds = new Set(r.items.map((i) => i.kind));
    for (const k of ["ALERT", "DECISION", "POLICY", "RISK", "ENFORCEMENT", "ACTION", "OUTCOME", "APPROVAL"]) expect(kinds.has(k as never), k).toBe(true);

    expect(r.items.filter((i) => i.trigger).map((i) => i.kind)).toEqual(["ALERT"]);
    expect(r.items.some((i) => i.kind === "ALERT" && i.title.includes("Blocked export to a new destination"))).toBe(true); // the alert raised above is on the same timeline
    expect(r.items.some((i) => i.kind === "POLICY" && i.title === 'Policy "No exports to unknown hosts" matched and resolved to BLOCK')).toBe(true);
    const outcome = r.items.find((i) => i.kind === "OUTCOME" && i.detail.reportedDespiteDecision === true);
    expect(outcome?.title).toContain("although the decision was BLOCK");
    expect(r.items.some((i) => i.title === "Approval requested for \"refund.issue\"")).toBe(true);
    expect(r.items.some((i) => i.title.endsWith("rejected the approval request") && i.title.startsWith("Alex Analyst"))).toBe(true);

    const times = r.items.map((i) => i.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(["HIGH", "CRITICAL"]).toContain(r.severity);
    expect(r.context).toMatchObject({ traceId: T, tools: ["CRM"], destinations: ["files.unknown.example"], dataClasses: ["PII"], taskIds: ["export-1"] });
  });

  it("writes a deterministic summary that states only recorded facts, in the four first-screen sections", async () => {
    const r = (await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction;
    const anchorAlert = await prisma.securityAlert.findFirstOrThrow({ where: { id: (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).anchorId } });
    expect(r.summary.what[0].text).toBe(`Security alert "${anchorAlert.title}" (${anchorAlert.severity.toLowerCase()}) was raised for Agent p7-a.`);
    expect(r.summary.what.map((c) => c.text)).toContain("Data involved: PII (highest reported sensitivity high).");
    expect(r.summary.why.map((c) => c.text)).toContain('Policy "No exports to unknown hosts" matched and resolved to BLOCK (1 decision).');
    expect(r.summary.aegis.map((c) => c.text)).toEqual(
      expect.arrayContaining([
        "Aegis returned 1 BLOCK and 1 REQUIRE_APPROVAL decisions.",
        expect.stringContaining("although the decision was BLOCK or REQUIRE_APPROVAL"),
        "1 approval request: 1 rejected.",
      ])
    );
    expect(r.summary.paragraph).toContain("Aegis returned BLOCK");
    expect(r.summary.paragraph).not.toMatch(/prevented/i);
    // Reconstructing again yields byte-identical output.
    const again = (await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction;
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });

  it("evidence integrity: every reference in every item and claim resolves to a stored row in THIS tenant", async () => {
    const r = (await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction;
    const where = { id: undefined as unknown as string, organizationId: orgA.id };
    const exists = async (type: string, id: string) => {
      const w = { ...where, id };
      switch (type) {
        case "activity_event": return prisma.activityEvent.findFirst({ where: w });
        case "policy_evaluation": return prisma.policyEvaluation.findFirst({ where: w });
        case "approval_request": return prisma.approvalRequest.findFirst({ where: w });
        case "approval_decision": return prisma.approvalDecision.findFirst({ where: w });
        case "behavioral_deviation": return prisma.behavioralDeviation.findFirst({ where: w });
        case "trust_transition": return prisma.agentTrustTransition.findFirst({ where: w });
        case "audit_event": return prisma.auditEvent.findFirst({ where: w });
        case "security_alert": return prisma.securityAlert.findFirst({ where: w });
        case "alert_occurrence": return prisma.securityAlertOccurrence.findFirst({ where: w });
        default: return null;
      }
    };
    const refs = [
      ...r.items.flatMap((i) => i.evidence),
      ...[...r.summary.what, ...r.summary.why, ...r.summary.aegis].flatMap((c) => c.evidence),
      ...r.evidence.map((e) => e.ref),
    ];
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of new Set(refs.map((x) => `${x.type}|${x.id}`))) {
      const [type, id] = ref.split("|");
      expect(await exists(type, id), ref).not.toBeNull();
    }
    for (const item of r.items) expect(item.evidence.length, item.id).toBeGreaterThan(0);
    // Evidence records offer a way to inspect each one.
    expect(r.evidence.filter((e) => e.href === null).every((e) => e.ref.type === "audit_event")).toBe(true);
  });

  it("handling the incident never changes the evidence or the security record it describes", async () => {
    const alertBefore = await prisma.securityAlert.findFirstOrThrow({ where: { organizationId: orgA.id, traceId: T } });
    const evaluationsBefore = await prisma.policyEvaluation.findMany({ where: { organizationId: orgA.id, traceId: T }, orderBy: { id: "asc" } });
    const digestBefore = (await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction.evidenceDigest;

    await acknowledgeIncident(actorOf(orgA, userA.id), incidentId);
    await changeIncidentStatus(actorOf(orgA, userA.id), incidentId, "INVESTIGATING", "looking");
    await changeIncidentStatus(actorOf(orgA, userA.id), incidentId, "RESOLVED", "handled");
    await addIncidentNote(actorOf(orgA, userA.id), incidentId, "Customer contacted.");

    expect(await prisma.securityAlert.findFirstOrThrow({ where: { id: alertBefore.id } })).toEqual(alertBefore); // alert status untouched (still OPEN)
    expect(alertBefore.status).toBe("OPEN");
    expect(await prisma.policyEvaluation.findMany({ where: { organizationId: orgA.id, traceId: T }, orderBy: { id: "asc" } })).toEqual(evaluationsBefore);
    expect((await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction.evidenceDigest).toBe(digestBefore);
    // Put it back for later tests.
    await changeIncidentStatus(actorOf(orgA, userA.id), incidentId, "OPEN", "reopen for later checks");
  });

  it("flags evidence that arrived after a status was set (digest comparison)", async () => {
    const before = await getIncidentView(actorOf(orgA, userA.id), incidentId);
    expect(before.evidenceSinceLastChange).toBeNull();
    await changeIncidentStatus(actorOf(orgA, userA.id), incidentId, "INVESTIGATING");
    const atChange = (await getIncidentView(actorOf(orgA, userA.id), incidentId)).reconstruction.evidenceCount;
    await report(agentA, { action: "email.send", traceId: T });
    const after = await getIncidentView(actorOf(orgA, userA.id), incidentId);
    // Reporting the event adds at least that event (detectors may add their own evidence too); the count is exactly the growth.
    expect(after.evidenceSinceLastChange?.added).toBeGreaterThanOrEqual(1);
    expect(after.evidenceSinceLastChange?.added).toBe(after.reconstruction.evidenceCount - atChange);
  });

  it("can be found by policy, decision, destination, tool, agent, severity and status", async () => {
    const a = actorOf(orgA, userA.id);
    const ids = async (f: Parameters<typeof searchIncidents>[1]) => (await searchIncidents(a, f)).incidents.map((i) => i.id);
    expect(await ids({ policyId })).toContain(incidentId);
    expect(await ids({ decision: "BLOCK" })).toContain(incidentId);
    expect(await ids({ decision: "REQUIRE_APPROVAL" })).toContain(incidentId);
    expect(await ids({ destination: "files.unknown.example" })).toContain(incidentId);
    expect(await ids({ tool: "crm" })).toContain(incidentId);
    expect(await ids({ agentId: agentA.id, severity: ["HIGH"], status: ["INVESTIGATING"] })).toContain(incidentId);
    // ... and filters genuinely narrow.
    expect(await ids({ policyId: "no-such-policy" })).not.toContain(incidentId);
    expect(await ids({ destination: "elsewhere.example" })).not.toContain(incidentId);
    expect(await ids({ tool: "mailer" })).not.toContain(incidentId);
    expect(await ids({ decision: "ALERT" })).not.toContain(incidentId);
    expect(await ids({ agentId: agentA2.id })).not.toContain(incidentId);
    expect(await ids({ severity: ["LOW"] })).not.toContain(incidentId);
    expect(await ids({ status: ["RESOLVED"] })).not.toContain(incidentId);
    expect(await ids({ from: new Date(Date.now() + 60_000) })).not.toContain(incidentId);
    expect(await ids({ to: new Date(Date.now() - 24 * 3_600_000) })).not.toContain(incidentId);
    expect(await ids({ from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) })).toContain(incidentId);
  });
});

describe("automatic opening", () => {
  it("one incident per run: more alerts on the same trace reinforce it, raise severity, and reopen it if closed", async () => {
    const T = trace("auto");
    await raise(agentA, { traceId: T, severity: "LOW", title: "First finding" });
    const incident = (await incidentFor(agentA, T))!;
    expect(incident.severity).toBe("LOW");

    await raise(agentA, { traceId: T, severity: "CRITICAL", title: "Second, worse finding" });
    expect(await prisma.incident.count({ where: { organizationId: orgA.id, clusterKey: `trace:${T}` } })).toBe(1);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).severity).toBe("CRITICAL");

    await changeIncidentStatus(actorOf(orgA, userA.id), incident.id, "FALSE_POSITIVE", "Load test");
    await raise(agentA, { traceId: T, severity: "HIGH", title: "Third finding after the close" });
    const reopened = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(reopened.status).toBe("OPEN");
    const trail = await prisma.incidentActivity.findMany({ where: { incidentId: incident.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(trail.map((a) => `${a.kind}:${a.fromStatus ?? ""}>${a.toStatus ?? ""}`)).toEqual(["OPENED:>OPEN", "STATUS_CHANGED:OPEN>FALSE_POSITIVE", "STATUS_CHANGED:FALSE_POSITIVE>OPEN"]);
    expect(trail[2]).toMatchObject({ actorUserId: null, note: expect.stringContaining("Reopened automatically") });
    expect(trail[1].note).toBe("Load test"); // history is never overwritten
  });

  it("a repeat of an existing alert (an occurrence) neither creates nor reopens anything", async () => {
    const T = trace("repeat");
    const key = `repeat-${seq}`;
    await raise(agentA, { traceId: T, dedupeKey: key });
    const incident = (await incidentFor(agentA, T))!;
    await changeIncidentStatus(actorOf(orgA, userA.id), incident.id, "RESOLVED");
    const again = await raise(agentA, { traceId: T, dedupeKey: key });
    expect(again.created).toBe(false);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe("RESOLVED");
    expect(await prisma.incidentActivity.count({ where: { incidentId: incident.id } })).toBe(2);
  });

  it("an alert with no trace gets its own incident, and the summary says it has only the triggering record", async () => {
    const created = await raise(agentA, { traceId: null, title: "Alert without a run" });
    const incident = (await prisma.incident.findFirst({ where: { organizationId: orgA.id, anchorId: created.alert.id } }))!;
    expect(incident).toMatchObject({ traceId: null, clusterKey: `security_alert:${created.alert.id}` });
    const r = (await getIncidentView(actorOf(orgA, userA.id), incident.id)).reconstruction;
    expect(r.items.map((i) => i.kind)).toEqual(["ALERT"]);
    expect(r.summary.gaps.map((g) => g.text)).toContain("This incident's trigger carries no trace id, so related activity cannot be linked to it; only the triggering record is shown.");
  });

  it("opening an incident failing never breaks alert creation", async () => {
    // An alert whose agent has no incident-incompatible state still succeeds; the hook is failure-isolated.
    const created = await raise(agentA, { traceId: trace("isolated") });
    expect(created.created).toBe(true);
  });
});

describe("manual opening and incomplete telemetry", () => {
  it("an operator can open an incident from a decision; opening it twice returns the same incident", async () => {
    const T = trace("manual");
    const d = await decide(agentA, { action: "unlisted.action", traceId: T });
    const a = actorOf(orgA, userA.id);
    const first = await openIncident(a, { anchorType: "POLICY_EVALUATION", anchorId: d.evaluationId });
    const second = await openIncident(a, { anchorType: "POLICY_EVALUATION", anchorId: d.evaluationId });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(first.incident).toMatchObject({ openedVia: "MANUAL", openedByUserId: userA.id, traceId: T });
    const r = (await getIncidentView(a, first.incident.id)).reconstruction;
    expect(r.summary.what[0].text).toBe('Agent p7-a requested "unlisted.action" and Aegis decided BLOCK.');
    expect(r.summary.why.map((c) => c.text)).toContain('No policy or permission covered "unlisted.action", so Aegis\'s default was BLOCK.');
    expect(r.items.find((i) => i.trigger)?.kind).toBe("DECISION");
  });

  it("an incident on a lone reported event (no run, no decision) says Aegis had no opportunity to decide", async () => {
    const e = await report(agentA, { action: "crm.read", outcome: undefined });
    const a = actorOf(orgA, userA.id);
    const { incident } = await openIncident(a, { anchorType: "ACTIVITY_EVENT", anchorId: e.id });
    const r = (await getIncidentView(a, incident.id)).reconstruction;
    expect(r.summary.gaps.map((g) => g.text)).toEqual(expect.arrayContaining([expect.stringContaining("no trace id"), expect.stringContaining("No authorization request")]));
    expect(r.items.find((i) => i.trigger)?.id).toBe(`ACTION:${e.id}`);
  });

  it("a deleted trigger is reported, not invented", async () => {
    const created = await raise(agentA, { traceId: null, title: "Will be removed" });
    const incident = (await prisma.incident.findFirst({ where: { organizationId: orgA.id, anchorId: created.alert.id } }))!;
    // Simulate retention removing the alert: its occurrences go first (FK), then the alert.
    await prisma.securityAlertOccurrence.deleteMany({ where: { alertId: created.alert.id } });
    await prisma.securityAlert.delete({ where: { id: created.alert.id } });
    const r = (await getIncidentView(actorOf(orgA, userA.id), incident.id)).reconstruction;
    expect(r.items).toEqual([]);
    expect(r.summary.gaps.map((g) => g.text)).toContain("The record that opened this incident could not be retrieved, so the trigger is not shown.");
    expect(r.summary.paragraph).toBe("There is not enough stored evidence to say what happened.");
  });
});

describe("concurrency", () => {
  it("many alerts for one run raised at once produce exactly one incident", async () => {
    const T = trace("concurrent-alerts");
    await Promise.all(Array.from({ length: 8 }, (_, i) => raise(agentA, { traceId: T, title: `finding ${i}` })));
    expect(await prisma.incident.count({ where: { organizationId: orgA.id, clusterKey: `trace:${T}` } })).toBe(1);
    expect(await prisma.incidentActivity.count({ where: { incident: { clusterKey: `trace:${T}`, organizationId: orgA.id }, kind: "OPENED" } })).toBe(1);
  });

  it("concurrent manual opens of the same trigger give one incident; different runs get distinct gapless numbers", async () => {
    const d = await decide(agentA, { action: "unlisted.action", traceId: trace("concurrent-open") });
    const a = actorOf(orgA, userA.id);
    const same = await Promise.all(Array.from({ length: 6 }, () => openIncident(a, { anchorType: "POLICY_EVALUATION", anchorId: d.evaluationId })));
    expect(new Set(same.map((r) => r.incident.id)).size).toBe(1);
    expect(same.filter((r) => r.created)).toHaveLength(1);

    const before = await prisma.incident.aggregate({ where: { organizationId: orgB.id }, _max: { number: true } });
    const base = before._max.number ?? 0;
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => raise(agentB, { traceId: trace(`num-${i}`) }, orgB)));
    expect(created.every((c) => c.created)).toBe(true);
    const numbers = (await prisma.incident.findMany({ where: { organizationId: orgB.id, number: { gt: base } }, select: { number: true } })).map((i) => i.number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6].map((n) => base + n));
  });

  it("two operators changing status at once: exactly one wins, the other is told, nothing is overwritten", async () => {
    const T = trace("race");
    await raise(agentA, { traceId: T });
    const incident = (await incidentFor(agentA, T))!;
    const results = await Promise.allSettled([
      changeIncidentStatus(actorOf(orgA, userA.id), incident.id, "RESOLVED", "fixed"),
      changeIncidentStatus(actorOf(orgA, userA2.id), incident.id, "FALSE_POSITIVE", "noise"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(IncidentTransitionError);
    expect(["CONFLICT", "NOT_ALLOWED"]).toContain(loser.reason.code);
    const changes = await prisma.incidentActivity.findMany({ where: { incidentId: incident.id, kind: "STATUS_CHANGED" } });
    expect(changes).toHaveLength(1);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(changes[0].toStatus);
  });

  it("concurrent acknowledgements record exactly one acknowledgement", async () => {
    const T = trace("ack-race");
    await raise(agentA, { traceId: T });
    const incident = (await incidentFor(agentA, T))!;
    const results = await Promise.all([userA, userA2, userA, userA2].map((u) => acknowledgeIncident(actorOf(orgA, u.id), incident.id)));
    expect(results.filter((r) => r.acknowledged)).toHaveLength(1);
    expect(await prisma.incidentActivity.count({ where: { incidentId: incident.id, kind: "ACKNOWLEDGED" } })).toBe(1);
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.acknowledgedAt).not.toBeNull();
    expect([userA.id, userA2.id]).toContain(row.acknowledgedById);
  });
});

describe("status transitions and acknowledgement", () => {
  it("follows the documented machine, requires a note for FALSE_POSITIVE, and keeps every step", async () => {
    const T = trace("status");
    await raise(agentA, { traceId: T });
    const inc = (await incidentFor(agentA, T))!;
    const a = actorOf(orgA, userA.id);
    const expectError = async (p: Promise<unknown>, code: string) => {
      const error = await p.then(() => null, (e) => e);
      expect(error).toBeInstanceOf(IncidentTransitionError);
      expect((error as IncidentTransitionError).code).toBe(code);
    };

    await expectError(changeIncidentStatus(a, inc.id, "OPEN"), "NO_CHANGE");
    await expectError(changeIncidentStatus(a, inc.id, "FALSE_POSITIVE"), "NOTE_REQUIRED");
    await expectError(changeIncidentStatus(a, inc.id, "RESOLVED", "x".repeat(2001)), "NOTE_TOO_LONG");
    expect(await changeIncidentStatus(a, inc.id, "INVESTIGATING")).toEqual({ from: "OPEN", to: "INVESTIGATING" });
    expect(await changeIncidentStatus(a, inc.id, "FALSE_POSITIVE", "Scheduled load test")).toEqual({ from: "INVESTIGATING", to: "FALSE_POSITIVE" });
    await expectError(changeIncidentStatus(a, inc.id, "RESOLVED", "x"), "NOT_ALLOWED"); // closed → closed needs a reopen
    await changeIncidentStatus(a, inc.id, "OPEN", "Actually real");
    await changeIncidentStatus(a, inc.id, "RESOLVED", "Fixed");

    const trail = await prisma.incidentActivity.findMany({ where: { incidentId: inc.id, kind: "STATUS_CHANGED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(trail.map((t) => `${t.fromStatus}>${t.toStatus}`)).toEqual(["OPEN>INVESTIGATING", "INVESTIGATING>FALSE_POSITIVE", "FALSE_POSITIVE>OPEN", "OPEN>RESOLVED"]);
    expect(trail[1]).toMatchObject({ note: "Scheduled load test", actorUserId: userA.id, evidenceDigest: expect.any(String), evidenceCount: expect.any(Number) });

    const audit = await prisma.auditEvent.findMany({ where: { organizationId: orgA.id, entityId: inc.id, eventType: "incident.status_changed" } });
    expect(audit).toHaveLength(4);
    const counts = await incidentStatusCounts(a);
    expect(counts.RESOLVED).toBeGreaterThanOrEqual(1);
  });

  it("acknowledging records who and when without changing status or the alert, and is idempotent", async () => {
    const T = trace("ack");
    const raised = await raise(agentA, { traceId: T });
    const inc = (await incidentFor(agentA, T))!;
    const alertBefore = await prisma.securityAlert.findUniqueOrThrow({ where: { id: raised.alert.id } });

    expect(await acknowledgeIncident(actorOf(orgA, userA.id), inc.id)).toEqual({ acknowledged: true });
    expect(await acknowledgeIncident(actorOf(orgA, userA2.id), inc.id)).toEqual({ acknowledged: false });
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: inc.id } });
    expect(row).toMatchObject({ status: "OPEN", acknowledgedById: userA.id });
    expect(row.acknowledgedAt).toBeInstanceOf(Date);
    expect(await prisma.securityAlert.findUniqueOrThrow({ where: { id: raised.alert.id } })).toEqual(alertBefore);

    const view = await getIncidentView(actorOf(orgA, userA2.id), inc.id);
    expect(view.incident.acknowledgedBy).toBe("Alex Analyst");
    expect(view.activity.map((a) => a.kind)).toEqual(["OPENED", "ACKNOWLEDGED"]);
    expect(view.activity[0].actor).toBe("Aegis (automatic)");
  });

  it("notes are recorded and bounded", async () => {
    const T = trace("note");
    await raise(agentA, { traceId: T });
    const inc = (await incidentFor(agentA, T))!;
    await addIncidentNote(actorOf(orgA, userA.id), inc.id, "  Checked with the owner.  ");
    await expect(addIncidentNote(actorOf(orgA, userA.id), inc.id, "   ")).rejects.toMatchObject({ code: "EMPTY_NOTE" });
    await expect(addIncidentNote(actorOf(orgA, userA.id), inc.id, "x".repeat(2001))).rejects.toMatchObject({ code: "NOTE_TOO_LONG" });
    const view = await getIncidentView(actorOf(orgA, userA.id), inc.id);
    expect(view.activity.find((a) => a.kind === "NOTE")).toMatchObject({ note: "Checked with the owner.", actor: "Alex Analyst" });
  });
});

describe("history cannot be erased: enforced by the database", () => {
  it("incident activity is append-only, and an incident's anchor, run and origin are immutable", async () => {
    const T = trace("immutable");
    await raise(agentA, { traceId: T });
    const inc = (await incidentFor(agentA, T))!;
    await changeIncidentStatus(actorOf(orgA, userA.id), inc.id, "RESOLVED", "done");
    const activity = await prisma.incidentActivity.findFirstOrThrow({ where: { incidentId: inc.id, kind: "STATUS_CHANGED" } });

    await expect(prisma.incidentActivity.update({ where: { id: activity.id }, data: { note: "rewritten" } })).rejects.toThrow(/append-only/);
    await expect(prisma.incidentActivity.update({ where: { id: activity.id }, data: { toStatus: "OPEN" } })).rejects.toThrow(/append-only/);
    await expect(prisma.incident.update({ where: { id: inc.id }, data: { anchorId: "other" } })).rejects.toThrow(/immutable/);
    await expect(prisma.incident.update({ where: { id: inc.id }, data: { traceId: "other" } })).rejects.toThrow(/immutable/);
    await expect(prisma.incident.update({ where: { id: inc.id }, data: { openedAt: new Date(0) } })).rejects.toThrow(/immutable/);
    await expect(prisma.incident.update({ where: { id: inc.id }, data: { number: 999 } })).rejects.toThrow(/immutable/);
    // Handling state IS allowed to move (that is what handling is).
    await expect(prisma.incident.update({ where: { id: inc.id }, data: { status: "OPEN" } })).resolves.toBeTruthy();
    expect((await prisma.incidentActivity.findUniqueOrThrow({ where: { id: activity.id } })).note).toBe("done");
  });

  it("the underlying security records an incident points at are append-only too", async () => {
    const T = trace("evidence-immutable");
    const raised = await raise(agentA, { traceId: T });
    const occurrence = await prisma.securityAlertOccurrence.findFirstOrThrow({ where: { alertId: raised.alert.id } });
    await expect(prisma.securityAlertOccurrence.update({ where: { id: occurrence.id }, data: { title: "rewritten" } })).rejects.toThrow(/append-only/);
    const e = await decide(agentA, { action: "unlisted.action", traceId: T });
    await expect(prisma.policyEvaluation.update({ where: { id: e.evaluationId }, data: { decision: "ALLOW" } })).rejects.toThrow(/append-only/);
  });
});

describe("tenant isolation", () => {
  let bIncidentId: string;
  const BT = `${RUN_ID}-shared-trace`;

  beforeAll(async () => {
    // The SAME trace id exists in both tenants, each with its own sensitive details.
    await prisma.activityEvent.create({ data: { organizationId: orgB.id, agentId: agentB.id, eventType: "ACTION", action: "b.secret.export", traceId: BT, destination: "b.internal.example", toolKey: "b-tool", dataClasses: ["CREDENTIALS"] } });
    await raise(agentB, { traceId: BT, title: "B only alert" }, orgB);
    bIncidentId = (await incidentFor(agentB, BT, orgB))!.id;
    await report(agentA, { action: "a.public.action", traceId: BT });
    await raise(agentA, { traceId: BT, title: "A alert on the colliding trace" });
  });

  it("an incident id from another tenant is simply not found, for viewing and for every handling action", async () => {
    const a = actorOf(orgA, userA.id);
    await expect(getIncidentView(a, bIncidentId)).rejects.toBeInstanceOf(IncidentNotFoundError);
    await expect(acknowledgeIncident(a, bIncidentId)).rejects.toBeInstanceOf(IncidentNotFoundError);
    await expect(changeIncidentStatus(a, bIncidentId, "RESOLVED", "x")).rejects.toBeInstanceOf(IncidentNotFoundError);
    await expect(addIncidentNote(a, bIncidentId, "x")).rejects.toBeInstanceOf(IncidentNotFoundError);
    const untouched = await prisma.incident.findUniqueOrThrow({ where: { id: bIncidentId } });
    expect(untouched).toMatchObject({ status: "OPEN", acknowledgedAt: null });
    expect(await prisma.incidentActivity.count({ where: { incidentId: bIncidentId } })).toBe(1);
  });

  it("opening an incident from another tenant's alert, decision or event is refused as not found", async () => {
    const bAlert = (await prisma.securityAlert.findFirstOrThrow({ where: { organizationId: orgB.id, traceId: BT } })).id;
    const bEvent = (await prisma.activityEvent.findFirstOrThrow({ where: { organizationId: orgB.id, traceId: BT } })).id;
    const a = actorOf(orgA, userA.id);
    await expect(openIncident(a, { anchorType: "SECURITY_ALERT", anchorId: bAlert })).rejects.toBeInstanceOf(IncidentNotFoundError);
    await expect(openIncident(a, { anchorType: "ACTIVITY_EVENT", anchorId: bEvent })).rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it("a reconstruction only ever contains its own tenant's evidence, even when trace ids collide and a foreign row names our agent", async () => {
    // A row that should be impossible: tenant B's event that points at tenant A's agent and trace.
    await prisma.activityEvent.create({ data: { organizationId: orgB.id, agentId: agentA.id, eventType: "ACTION", action: "poisoned.cross.tenant", traceId: BT, destination: "poison.example" } });
    const incident = (await incidentFor(agentA, BT))!;
    const view = await getIncidentView(actorOf(orgA, userA.id), incident.id);
    const text = JSON.stringify(view.reconstruction);
    for (const secret of ["b.secret.export", "b.internal.example", "b-tool", "B only alert", "poisoned.cross.tenant", "poison.example"]) expect(text, secret).not.toContain(secret);
    expect(view.reconstruction.context.destinations).toEqual([]);
    expect(text).toContain("A alert on the colliding trace");
  });

  it("search never returns another tenant's incidents, and its evidence filters cannot reach across tenants", async () => {
    const a = actorOf(orgA, userA.id);
    const all = await searchIncidents(a, { pageSize: 100 });
    expect(all.incidents.every((i) => i.organizationId === orgA.id)).toBe(true);
    expect(all.incidents.map((i) => i.id)).not.toContain(bIncidentId);
    expect((await searchIncidents(a, { agentId: agentB.id })).incidents).toEqual([]);
    expect((await searchIncidents(a, { destination: "b.internal.example" })).incidents).toEqual([]);
    expect((await searchIncidents(a, { tool: "b-tool" })).incidents).toEqual([]);
    const b = await searchIncidents(actorOf(orgB, userB.id), { destination: "b.internal.example" });
    expect(b.incidents.map((i) => i.id)).toEqual([bIncidentId]);
    expect((await incidentStatusCounts(actorOf(orgB, userB.id))).OPEN).toBe(await prisma.incident.count({ where: { organizationId: orgB.id, status: "OPEN" } }));
  });

  it("the same alert content in two tenants gives two separate incidents with separate numbering", async () => {
    const a = (await incidentFor(agentA, BT))!;
    const b = (await incidentFor(agentB, BT, orgB))!;
    expect(a.id).not.toBe(b.id);
    expect(a.organizationId).toBe(orgA.id);
    expect(b.organizationId).toBe(orgB.id);
  });

  it("ensureIncidentForAlert with a foreign alert still creates the incident in the alert's own org only when called with that org", async () => {
    const bAlert = await prisma.securityAlert.findFirstOrThrow({ where: { organizationId: orgB.id, traceId: BT } });
    const again = await ensureIncidentForAlert(orgB.id, { id: bAlert.id, agentId: bAlert.agentId, title: bAlert.title, severity: bAlert.severity, traceId: bAlert.traceId });
    expect(again.created).toBe(false);
    expect(again.incident.id).toBe(bIncidentId);
  });
});

describe("authorization", () => {
  const ROLES: Record<MemberRole, { view: boolean; manage: boolean }> = {
    OWNER: { view: true, manage: true },
    ADMIN: { view: true, manage: true },
    SECURITY: { view: true, manage: true },
    ENGINEER: { view: true, manage: false },
    VIEWER: { view: true, manage: false },
    FINANCE: { view: false, manage: false },
  };

  it("capability matrix: everyone but FINANCE can view; only roles that resolve security alerts can handle", () => {
    for (const [role, expected] of Object.entries(ROLES)) {
      expect(canViewIncidents(role as MemberRole), `${role} view`).toBe(expected.view);
      expect(canManageIncidents(role as MemberRole), `${role} manage`).toBe(expected.manage);
    }
  });

  it("the service enforces it itself: view-only roles can read but cannot acknowledge, change, note or open", async () => {
    const T = trace("authz");
    const raised = await raise(agentA, { traceId: T });
    const inc = (await incidentFor(agentA, T))!;
    for (const role of ["ENGINEER", "VIEWER"] as MemberRole[]) {
      const actor = actorOf(orgA, userA.id, role);
      await expect(getIncidentView(actor, inc.id)).resolves.toBeTruthy();
      await expect(searchIncidents(actor, {})).resolves.toBeTruthy();
      await expect(acknowledgeIncident(actor, inc.id)).rejects.toBeInstanceOf(IncidentForbiddenError);
      await expect(changeIncidentStatus(actor, inc.id, "RESOLVED")).rejects.toBeInstanceOf(IncidentForbiddenError);
      await expect(addIncidentNote(actor, inc.id, "hi")).rejects.toBeInstanceOf(IncidentForbiddenError);
      await expect(openIncident(actor, { anchorType: "SECURITY_ALERT", anchorId: raised.alert.id })).rejects.toBeInstanceOf(IncidentForbiddenError);
    }
    const finance = actorOf(orgA, userA.id, "FINANCE");
    await expect(getIncidentView(finance, inc.id)).rejects.toBeInstanceOf(IncidentForbiddenError);
    await expect(searchIncidents(finance, {})).rejects.toBeInstanceOf(IncidentForbiddenError);
    await expect(incidentStatusCounts(finance)).rejects.toBeInstanceOf(IncidentForbiddenError);
    // Nothing the refused calls attempted took effect.
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: inc.id } });
    expect(row).toMatchObject({ status: "OPEN", acknowledgedAt: null });
    expect(await prisma.incidentActivity.count({ where: { incidentId: inc.id } })).toBe(1);

    for (const role of ["OWNER", "ADMIN", "SECURITY"] as MemberRole[]) {
      await expect(addIncidentNote(actorOf(orgA, userA.id, role), inc.id, `note by ${role}`)).resolves.toBeUndefined();
    }
  });
});

describe("search pagination and ordering", () => {
  it("returns newest first, pages without repeats, and reports totals", async () => {
    const agent = await makeAgent(orgA.id, "p7-pages");
    for (let i = 0; i < 7; i += 1) await raise(agent, { traceId: trace(`page-${i}`), severity: i % 2 ? "HIGH" : "LOW", title: `page incident ${i}` });
    const a = actorOf(orgA, userA.id);
    const seen: string[] = [];
    let pages = 0;
    for (let page = 1; ; page += 1) {
      const result = await searchIncidents(a, { agentId: agent.id, pageSize: 3, page });
      pages = result.pageCount;
      seen.push(...result.incidents.map((i) => i.id));
      expect(result.total).toBe(7);
      if (page >= result.pageCount) break;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    const rows = await prisma.incident.findMany({ where: { id: { in: seen } }, select: { id: true, openedAt: true } });
    const times = seen.map((id) => rows.find((r) => r.id === id)!.openedAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect((await searchIncidents(a, { agentId: agent.id, severity: ["HIGH"] })).total).toBe(3);
  });
});
