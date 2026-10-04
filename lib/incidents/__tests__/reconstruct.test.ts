import { describe, expect, it } from "vitest";

import { MAX_CLAIM_EVIDENCE, MAX_ITEMS, describeDeviation, reconstructIncident } from "@/lib/incidents/reconstruct";
import type { BundleEvaluation, BundleEvent, EvidenceBundle, Reconstruction } from "@/lib/incidents/types";

const T0 = new Date("2026-10-08T10:00:00.000Z").getTime();
const at = (s: number) => new Date(T0 + s * 1000);

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    incident: { id: "inc1", number: 7, anchorType: "SECURITY_ALERT", anchorId: "alert1", traceId: "trace-1" },
    agent: { id: "agent1", name: "Support Bot", slug: "support-bot" },
    alerts: [],
    occurrences: [],
    events: [],
    evaluations: [],
    approvals: [],
    approvalDecisions: [],
    deviations: [],
    trust: [],
    control: [],
    truncated: { events: false, evaluations: false, alerts: false, deviations: false },
    ...over,
  };
}

const event = (o: Partial<BundleEvent> & { id: string }): BundleEvent => ({
  timestamp: at(0),
  source: "api",
  eventType: "ACTION",
  action: "crm.export",
  resource: null,
  toolName: null,
  toolKey: null,
  service: null,
  destination: null,
  dataClasses: [],
  dataSensitivity: null,
  recordCount: null,
  byteCount: null,
  status: "ALLOWED",
  riskLevel: "LOW",
  outcome: null,
  evaluationId: null,
  parentEventId: null,
  taskId: null,
  endUserHash: null,
  ...o,
});

const evaluation = (o: Partial<BundleEvaluation> & { id: string }): BundleEvaluation => ({
  createdAt: at(0),
  action: "crm.export",
  resource: null,
  decision: "ALLOW",
  policyDecision: "ALLOW",
  decisionSource: "POLICY",
  reason: "Allowed by permission.",
  matchedPolicies: [],
  permission: { action: "crm.export", decision: "ALLOW" },
  riskAssessedLevel: null,
  riskRecommendedDecision: null,
  riskControlOutcome: null,
  riskControlMode: null,
  riskSignals: [],
  trust: null,
  agentStatus: "ACTIVE",
  consumedApprovalRequestId: null,
  activityEventId: null,
  ...o,
});

const alert = { id: "alert1", type: "BLOCK_SPIKE", severity: "HIGH" as const, title: "Unusual blocks", description: "The agent was blocked 6 times in an hour.", confidence: "HIGH", traceId: "trace-1", firstSeenAt: at(5), lastSeenAt: at(5), count: 1, evidence: { n: 6 } };

/** The full story from the brief: unusual destination + sensitive data + policy → BLOCK. */
function fullStory(): EvidenceBundle {
  return bundle({
    incident: { id: "inc1", number: 7, anchorType: "POLICY_EVALUATION", anchorId: "eval1", traceId: "trace-1" },
    events: [
      event({ id: "ev-dec", source: "policy_evaluation", timestamp: at(10), status: "BLOCKED", toolName: "CRM", toolKey: "crm", destination: "files.unknown.example", dataClasses: ["PII"], dataSensitivity: "HIGH", recordCount: 80 }),
      event({ id: "ev-exec", timestamp: at(12), evaluationId: "eval1", outcome: "SUCCESS", toolName: "CRM", toolKey: "crm", destination: "files.unknown.example", dataClasses: ["PII"], dataSensitivity: "HIGH", parentEventId: "ev-dec" }),
    ],
    evaluations: [
      evaluation({
        id: "eval1",
        createdAt: at(10),
        decision: "BLOCK",
        policyDecision: "BLOCK",
        activityEventId: "ev-dec",
        matchedPolicies: [{ id: "pol1", name: "No unknown exports", decision: "BLOCK" }],
        riskAssessedLevel: "HIGH",
        riskRecommendedDecision: "BLOCK",
        riskControlOutcome: "OBSERVED",
        riskControlMode: "OBSERVE",
        riskSignals: [
          { code: "new_destination", family: "behavior", severity: "MEDIUM" },
          { code: "sensitive_data", family: "request", severity: "MEDIUM" },
        ],
        trust: { state: "DEGRADED", score: 52 },
      }),
    ],
    deviations: [{ id: "dev1", kind: "NEW_DESTINATION", confidence: "HIGH", observed: { value: "files.unknown.example" }, eventId: "ev-dec", firstSeenAt: at(11), occurrences: 1, baselineVersion: 3 }],
    trust: [{ id: "tr1", occurredAt: at(20), previousState: "NORMAL", newState: "DEGRADED", previousScore: 70, newScore: 52, trigger: "POLICY_EVALUATION" }],
  });
}

const allClaims = (r: Reconstruction) => [...r.summary.what, ...r.summary.why, ...r.summary.aegis, ...r.summary.gaps];

describe("reconstruction from a full story", () => {
  const r = reconstructIncident(fullStory());

  it("builds every kind of item from stored rows, in causal order at the same instant", () => {
    const kinds = r.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["DECISION", "POLICY", "RISK", "ENFORCEMENT", "DEVIATION", "ACTION", "OUTCOME", "TRUST"]));
    const decisionAt = r.items.filter((i) => i.at.getTime() === at(10).getTime()).map((i) => i.kind);
    expect(decisionAt).toEqual(["DECISION", "POLICY", "RISK", "DEVIATION", "ENFORCEMENT"]);
    const times = r.items.map((i) => i.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("marks exactly one trigger: the record that opened the incident", () => {
    const triggers = r.items.filter((i) => i.trigger);
    expect(triggers.map((t) => t.id)).toEqual(["DECISION:eval1"]);
  });

  it("does not duplicate a decision's own activity event as a separate action", () => {
    expect(r.items.some((i) => i.id === "ACTION:ev-dec")).toBe(false);
    expect(r.items.some((i) => i.id === "ACTION:ev-exec")).toBe(true);
  });

  it("states what Aegis returned without claiming anything was prevented, and flags the execution reported despite the decision", () => {
    const enforcement = r.items.find((i) => i.kind === "ENFORCEMENT")!;
    expect(enforcement.title).toBe("Aegis returned BLOCK to the agent");
    const outcome = r.items.find((i) => i.kind === "OUTCOME")!;
    expect(outcome.title).toContain("although the decision was BLOCK");
    expect(outcome.detail.reportedDespiteDecision).toBe(true);
    const text = JSON.stringify(r.summary);
    expect(text).not.toMatch(/\bprevented\b|\bstopped the action\b/i);
    expect(r.summary.aegis.some((c) => c.text.includes("cannot stop an integration that does not honor them"))).toBe(true);
  });

  it("writes the concise paragraph from facts only", () => {
    expect(r.summary.paragraph).toBe(
      'Support Bot requested "crm.export" and Aegis decided BLOCK. Data involved: PII (highest reported sensitivity high). ' +
        "Behavioral deviation from the agent's baseline: new destination \"files.unknown.example\" (not in the agent's baseline, high confidence). " +
        'Policy "No unknown exports" matched and resolved to BLOCK (1 decision). Aegis returned BLOCK for "crm.export" (decided by a policy or permission). ' +
        "1 execution was reported as completed although the decision was BLOCK or REQUIRE_APPROVAL. Aegis returns decisions; it cannot stop an integration that does not honor them."
    );
    expect(r.summary.paragraph).not.toMatch(/customer/i);
  });

  it("derives the first-screen sections", () => {
    expect(r.summary.what.map((c) => c.text)).toEqual([
      'Support Bot requested "crm.export" and Aegis decided BLOCK.',
      "In this run Support Bot made 1 authorization request and reported 1 action, using CRM and reaching files.unknown.example.",
      "Data involved: PII (highest reported sensitivity high).",
      "Largest single volume reported: 80 records.",
    ]);
    expect(r.summary.why.map((c) => c.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Behavioral deviation from the agent's baseline: new destination"),
        'Policy "No unknown exports" matched and resolved to BLOCK (1 decision).',
        "Risk was assessed high at its highest across 1 decision (signals: new destination and sensitive data).",
        "Agent trust changed normal to degraded (score 70 to 52).",
      ])
    );
    expect(r.summary.aegis[0].text).toBe("Aegis returned 1 BLOCK decision.");
    expect(r.severity).toBe("HIGH");
    expect(r.context).toMatchObject({ traceId: "trace-1", tools: ["CRM"], destinations: ["files.unknown.example"], dataClasses: ["PII"] });
  });

  it("is deterministic and independent of input order", () => {
    const b = fullStory();
    const shuffled: EvidenceBundle = { ...b, events: [...b.events].reverse(), deviations: [...b.deviations].reverse(), trust: [...b.trust].reverse() };
    expect(JSON.stringify(reconstructIncident(shuffled))).toBe(JSON.stringify(reconstructIncident(b)));
    expect(JSON.stringify(reconstructIncident(b))).toBe(JSON.stringify(r));
  });
});

describe("evidence integrity: nothing is invented", () => {
  const stories: [string, EvidenceBundle][] = [
    ["full story", fullStory()],
    ["alert only", bundle({ alerts: [alert], occurrences: [{ id: "occ1", alertId: "alert1", occurredAt: at(5), severity: "HIGH", title: "Unusual blocks" }] })],
    ["approvals and control", approvalsStory()],
  ];

  it.each(stories)("every timeline item and every claim of the %s points at stored rows", (_name, b) => {
    const r = reconstructIncident(b);
    const known = new Set(r.evidence.map((e) => `${e.ref.type}:${e.ref.id}`));
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(item.evidence.length, item.id).toBeGreaterThan(0);
      for (const ref of item.evidence) expect(known.has(`${ref.type}:${ref.id}`), `${item.id} -> ${ref.type}:${ref.id}`).toBe(true);
    }
    for (const c of allClaims(r)) {
      for (const ref of c.evidence) expect(known.has(`${ref.type}:${ref.id}`), c.text).toBe(true);
    }
  });

  it("every evidence record is real input: the record set equals the bundle's rows, no more", () => {
    const b = fullStory();
    const r = reconstructIncident(b);
    const expected = [...b.events.map((e) => `activity_event:${e.id}`), ...b.evaluations.map((e) => `policy_evaluation:${e.id}`), ...b.deviations.map((d) => `behavioral_deviation:${d.id}`), ...b.trust.map((t) => `trust_transition:${t.id}`)].sort();
    expect(r.evidence.map((e) => `${e.ref.type}:${e.ref.id}`).sort()).toEqual(expected);
    expect(r.evidenceCount).toBe(expected.length);
  });

  it("substantive claims carry evidence; only the 'not recorded' notes about absence may carry none", () => {
    const r = reconstructIncident(fullStory());
    for (const c of [...r.summary.what, ...r.summary.why, ...r.summary.aegis]) expect(c.evidence.length, c.text).toBeGreaterThan(0);
  });

  it("the digest changes when (and only when) evidence is added", () => {
    const b = fullStory();
    const base = reconstructIncident(b).evidenceDigest;
    expect(reconstructIncident({ ...b }).evidenceDigest).toBe(base);
    const extra = reconstructIncident({ ...b, events: [...b.events, event({ id: "ev-new", timestamp: at(30) })] });
    expect(extra.evidenceDigest).not.toBe(base);
    expect(extra.evidenceCount).toBe(reconstructIncident(b).evidenceCount + 1);
  });

  it("refuses to treat absence as fact: no policy, risk, trust or deviation claims without rows", () => {
    const r = reconstructIncident(bundle({ events: [event({ id: "e1", toolName: "CRM" })] }));
    expect(r.summary.why).toEqual([]);
    expect(allClaims(r).map((c) => c.text).join(" ")).not.toMatch(/policy|risk|trust|deviation|blocked/i);
  });

  it("bounds the evidence listed per claim but keeps the true total", () => {
    const events = Array.from({ length: 80 }, (_, i) => event({ id: `e${String(i).padStart(3, "0")}`, timestamp: at(i), toolName: "CRM" }));
    const r = reconstructIncident(bundle({ events }));
    const claim = r.summary.what.find((c) => c.text.startsWith("In this run"))!;
    expect(claim.evidence).toHaveLength(MAX_CLAIM_EVIDENCE);
    expect(claim.evidenceTotal).toBe(80);
  });

  it("sanitizes stored detail: reasoning-shaped alert evidence fields are withheld", () => {
    const r = reconstructIncident(bundle({ alerts: [{ ...alert, evidence: { count: 3, reasoning: "because the agent wanted", nested: { thoughts: "x" } } }] }));
    const rec = r.evidence.find((e) => e.ref.type === "security_alert")!;
    expect(JSON.stringify(rec.data)).not.toContain("because the agent wanted");
    expect(JSON.stringify(rec.data)).toContain("withheld");
  });
});

function approvalsStory(): EvidenceBundle {
  return bundle({
    incident: { id: "inc1", number: 7, anchorType: "POLICY_EVALUATION", anchorId: "eval-gated", traceId: "trace-1" },
    events: [event({ id: "ev-g", source: "policy_evaluation", timestamp: at(1), status: "APPROVAL_REQUIRED" })],
    evaluations: [
      evaluation({ id: "eval-gated", createdAt: at(1), decision: "REQUIRE_APPROVAL", activityEventId: "ev-g", decisionSource: "RISK", riskControlOutcome: "ESCALATED", riskAssessedLevel: "HIGH", riskRecommendedDecision: "REQUIRE_APPROVAL" }),
      evaluation({ id: "eval-ok", createdAt: at(60), decision: "ALLOW", decisionSource: "APPROVAL", consumedApprovalRequestId: "ap1" }),
    ],
    approvals: [{ id: "ap1", policyEvaluationId: "eval-gated", action: "crm.export", status: "APPROVED", requestedAt: at(1), resolvedAt: at(30), consumedAt: at(60), consumedByEvaluationId: "eval-ok" }],
    approvalDecisions: [{ id: "ad1", approvalRequestId: "ap1", decision: "APPROVED", decidedByUserId: "u1", decidedByLabel: "Sam Lee", comment: "Verified with the customer", createdAt: at(30) }],
    control: [{ id: "au1", eventType: "agent.paused", createdAt: at(90), actorLabel: "Sam Lee", reason: "drill" }],
  });
}

describe("approvals, enforcement and operator control", () => {
  const r = reconstructIncident(approvalsStory());

  it("shows the request, the human decision, the consumption, and the pause — each from its own row", () => {
    const titles = r.items.map((i) => i.title);
    expect(titles).toContain('Approval requested for "crm.export"');
    expect(titles).toContain("Sam Lee approved the approval request");
    expect(titles).toContain("Approval consumed: the approved request was used once");
    expect(titles).toContain("Sam Lee paused the agent");
    expect(titles).toContain("Aegis returned REQUIRE_APPROVAL and opened an approval request");
    expect(titles).toContain("Aegis allowed the action under a consumed human approval");
  });

  it("tallies approvals and notes risk control's role", () => {
    const aegis = r.summary.aegis.map((c) => c.text);
    expect(aegis).toContain("1 approval request: 1 approved; 1 used.");
    expect(aegis).toContain("Risk control made 1 decision stricter than policy alone.");
    expect(aegis).toContain("Sam Lee paused the agent.");
  });
});

describe("incomplete telemetry", () => {
  it("an alert with no trace says plainly that only the triggering record is shown", () => {
    const r = reconstructIncident(bundle({ incident: { id: "i", number: 1, anchorType: "SECURITY_ALERT", anchorId: "alert1", traceId: null }, alerts: [{ ...alert, traceId: null }] }));
    expect(r.items.map((i) => i.kind)).toEqual(["ALERT"]);
    expect(r.summary.gaps.map((g) => g.text)).toContain("This incident's trigger carries no trace id, so related activity cannot be linked to it; only the triggering record is shown.");
    expect(r.summary.what[0].text).toBe('Security alert "Unusual blocks" (high) was raised for Support Bot.');
    expect(r.summary.why[0].text).toBe("Detector finding: The agent was blocked 6 times in an hour.");
  });

  it("a trigger that cannot be retrieved is reported, not fabricated", () => {
    const r = reconstructIncident(bundle({ incident: { id: "i", number: 1, anchorType: "POLICY_EVALUATION", anchorId: "gone", traceId: "t" }, events: [event({ id: "e1" })] }));
    expect(r.items.some((i) => i.trigger)).toBe(false);
    expect(r.summary.gaps.map((g) => g.text)).toContain("The record that opened this incident could not be retrieved, so the trigger is not shown.");
    expect(r.summary.what.map((c) => c.text).join(" ")).not.toContain("decided");
  });

  it("actions with no decision recorded: says Aegis had no opportunity to decide", () => {
    const r = reconstructIncident(bundle({ incident: { id: "i", number: 1, anchorType: "ACTIVITY_EVENT", anchorId: "e1", traceId: "t" }, events: [event({ id: "e1", outcome: "SUCCESS" })] }));
    expect(r.summary.gaps.map((g) => g.text)).toContain("No authorization request (decision) is recorded for this run, so Aegis had no opportunity to decide on the reported actions.");
    expect(r.items.find((i) => i.trigger)!.id).toBe("ACTION:e1");
  });

  it("decisions without a risk assessment are counted as a gap; a missing parent event is stated", () => {
    const r = reconstructIncident(
      bundle({
        incident: { id: "i", number: 1, anchorType: "POLICY_EVALUATION", anchorId: "e1", traceId: "t" },
        evaluations: [evaluation({ id: "e1" }), evaluation({ id: "e2", createdAt: at(1) })],
        events: [event({ id: "x", parentEventId: "not-here" })],
      })
    );
    const gaps = r.summary.gaps.map((g) => g.text);
    expect(gaps).toContain("2 decisions have no risk assessment recorded (made before the risk engine existed, or it was unavailable).");
    expect(gaps).toContain("1 event refers to a parent event that is not part of this evidence.");
  });

  it("says when a cap hid evidence, and an empty bundle says there is not enough evidence", () => {
    const r = reconstructIncident(bundle({ events: [event({ id: "e1" })], truncated: { events: true, evaluations: true, alerts: true, deviations: true } }));
    expect(r.summary.gaps.map((g) => g.text)).toEqual(expect.arrayContaining([expect.stringContaining("more activity than is shown"), expect.stringContaining("more decisions"), expect.stringContaining("More security alerts"), expect.stringContaining("More behavioral deviations")]));
    expect(r.truncated.events).toBe(true);
    expect(reconstructIncident(bundle()).summary.paragraph).toBe("There is not enough stored evidence to say what happened.");
  });

  it("a deviation whose event is outside the evidence still appears, timed by when it was first seen", () => {
    const r = reconstructIncident(bundle({ deviations: [{ id: "d", kind: "UNUSUAL_VOLUME", confidence: "MEDIUM", observed: { unit: "records", value: 12000, ratioToP95: 8.2 }, eventId: "missing", firstSeenAt: at(44), occurrences: 2, baselineVersion: 1 }] }));
    const item = r.items.find((i) => i.kind === "DEVIATION")!;
    expect(item.at).toEqual(at(44));
    expect(item.title).toBe("Unusual for this agent: unusual volume: 12,000 records (8.2× its 95th percentile) (medium confidence)");
    expect(item.evidence).toEqual([{ type: "behavioral_deviation", id: "d" }]);
  });
});

describe("concurrent events", () => {
  it("events at the identical instant order deterministically by kind then id", () => {
    const events = ["e-c", "e-a", "e-b"].map((id) => event({ id, timestamp: at(0), outcome: "SUCCESS" }));
    const forward = reconstructIncident(bundle({ events }));
    const backward = reconstructIncident(bundle({ events: [...events].reverse() }));
    expect(forward.items.map((i) => i.id)).toEqual(["ACTION:e-a", "ACTION:e-b", "ACTION:e-c", "OUTCOME:e-a", "OUTCOME:e-b", "OUTCOME:e-c"]);
    expect(backward.items.map((i) => i.id)).toEqual(forward.items.map((i) => i.id));
  });

  it("keeps the trigger visible when the timeline is capped", () => {
    const events = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => event({ id: `e${String(i).padStart(4, "0")}`, timestamp: at(i) }));
    const last = events[events.length - 1];
    const r = reconstructIncident(bundle({ incident: { id: "i", number: 1, anchorType: "ACTIVITY_EVENT", anchorId: last.id, traceId: "t" }, events }));
    expect(r.items).toHaveLength(MAX_ITEMS);
    expect(r.truncated.items).toBe(true);
    expect(r.items.some((i) => i.trigger)).toBe(true);
    expect(r.evidenceCount).toBe(MAX_ITEMS + 50); // evidence is never truncated by the display cap
  });
});

describe("describeDeviation", () => {
  it("is built only from the stored observed values", () => {
    expect(describeDeviation("NEW_END_USER", { value: "hash" }, "LOW")).toBe("an end user the agent had not served before (low confidence)");
    expect(describeDeviation("UNUSUAL_TIME", { hourOfDayUtc: 3 }, "HIGH")).toBe("activity at an unusual hour (03:00 UTC, high confidence)");
    expect(describeDeviation("SOMETHING_NEW", {}, "HIGH")).toBe("something new (high confidence)");
  });
});
