# Aegis Control Engine — V2 Design (proposal, not implemented)

> Status: **design only.** Nothing in this document exists in the code yet
> unless it's marked *(exists)*. It builds on the verified state in
> `docs/AEGIS_CURRENT_STATE.md` and reuses existing modules wherever
> possible. Prioritization is in `docs/AEGIS_V2_ROADMAP.md`.

The loop: **OBSERVE → UNDERSTAND → ASSESS RISK → APPROVE → ENFORCE → AUDIT**

Design rules carried over from the codebase, which stay non-negotiable:

1. **Deterministic and explainable.** Every number has named inputs. No ML
   until there's labeled data to justify it, and even then only as an
   additional, labeled signal.
2. **Honest about enforcement.** Use `EnforcementOutcome` *(exists)*
   everywhere. "Blocked" means Aegis returned BLOCK; "prevented" needs
   evidence the agent complied.
3. **Observable metadata only.** Never store or display prompts, model
   output, or chain-of-thought. Only actions, parameters the caller chooses
   to send (redacted), and outcomes.
4. **Never fabricate.** Timelines, baselines, and consequences come from
   stored rows. Missing data is shown as missing.
5. **Risk only escalates.** Behavioral risk can make a decision stricter
   than policy, never looser. A policy BLOCK always wins.

---

## 1. One pipeline (Step 3)

Today `evaluateAgentAction()` is *policy → persist → (afterwards) detectors*.
V2 keeps the same function and the same `PolicyEvaluation` audit row, and
inserts the missing stages:

```
                     ┌──────────── synchronous, latency budget ≤ 150 ms p95 ────────────┐
 POST /evaluate ──►  1 NORMALIZE   ActionEnvelope (server-authoritative fields)          │
                     2 CONTROL     Agent.status / connection / trust=QUARANTINED gate     │
                     3 POLICY      resolveDecision()  (exists, unchanged)               │
                     4 SIGNALS     static + behavioral + contextual + trust signals     │
                     5 DECIDE      combine(policy, risk, trust)  → ALLOW|APPROVE|BLOCK|LOG│
                     6 RECORD      PolicyEvaluation (+ explanation) + ActivityEvent      │
                                   + ApprovalRequest (exists, same transaction)          │
                     7 RESPOND     decision + explanation + enforcement expectations     │
                     └───────────────────────────────────────────────────────────────────┘
                     ┌──────────── after() — Next.js 16 `after` from next/server ─────────┐
                     8 DETECT      runSecurityDetectors (exists) → alerts                 │
                     9 LEARN       rollup increment → baseline refresh when stale         │
                    10 TRUST       append AgentTrustEvent(s), recompute trust state       │
                    11 NOTIFY      webhooks (exists, moved off the request path)          │
                     └───────────────────────────────────────────────────────────────────┘
 POST /events  ──►  same NORMALIZE → SIGNALS → RECORD (decision = "observed", not enforced)
                    → after(): DETECT / LEARN / TRUST / NOTIFY
```

`/events` and `/evaluate` share stages 1, 4, 8–11. That fixes the
current split where per-event risk scoring runs only on `/events` and the
caller-asserted `riskLevel` is used on `/evaluate`.

### 1.1 ActionEnvelope (stage 1): stop trusting omitted fields

| Field | V2 rule | Fixes |
|---|---|---|
| `environment` | `input.environment ?? agent.environment` | Policy scope bypass by omission (current-state §8.2) |
| `riskLevel` | `max(caller, scoreEventRisk(...), agent.riskLevel)` | Caller can no longer under-declare risk |
| `tool` | Stored on both `PolicyEvaluation.tool` **and** `ActivityEvent.toolName` | Tool history currently split across tables |
| `traceId` | Always present (server-generated if missing, as `/evaluate` already does) | Uncorrelated `/events` rows |
| `parentEventId` | Accepted from the API and validated to be in the same org and trace | Field exists but is never written |
| **new** `destination` | Normalized host / domain / recipient domain / bucket | Destination baselines, exfiltration detection |
| **new** `principal` | Opaque end-user or on-behalf-of ID (hashed if caller asks) | "Normal users", per-user anomaly |
| **new** `dataClass` | Enum-ish string: `pii`, `financial`, `credentials`, `health`, `public`, … (caller-declared, with keyword inference as a fallback, labeled as inferred) | Sensitive-data signals |
| **new** `volume` | `{ records?: int, bytes?: int, amountCents?: int }` | Volume baselines, "what would have happened" |

Fields the caller omits become **explicitly unknown** (`null`), and policies
get an explicit `MISSING` semantic. In V2, a scoped policy whose scope field
is unknown is treated as **matching** for BLOCK and REQUIRE_APPROVAL
(fail-closed) and **not matching** for ALLOW. This is the one deliberate
behavior change in the policy engine. It needs a migration note and a
per-org opt-out for one release.

### 1.2 Control gate (stage 2)

Read `Agent.status` *(column exists, never read today)*:

| Agent state | Decision | Explanation |
|---|---|---|
| `STOPPED` | BLOCK | "Agent stopped by {actor} at {time}: {reason}" (from `AuditEvent`) |
| `PAUSED` | BLOCK, or APPROVE (per-org setting, default BLOCK) | same |
| `ARCHIVED` | BLOCK | |
| connection `DISCONNECTED` | 409 *(exists)* | |
| trust `QUARANTINED` | APPROVE for everything | Trust ledger reasons |

This turns the kill switch into **real cooperative enforcement**: every
integration that already calls `/evaluate` starts honoring pause and stop
with zero code changes. `NullEnforcementConnector` stays honest about
*external* halting, and the UI can say: "Aegis will refuse every
authorization request from this agent. Integrations that call
`/evaluate` before acting will stop."

### 1.3 Decision vocabulary (stage 5)

| Product term | Stored `PolicyDecision` | Activity status | Meaning |
|---|---|---|---|
| **ALLOW** | `ALLOW` *(exists)* | ALLOWED | Proceed |
| **APPROVE** | `REQUIRE_APPROVAL` *(exists)* | APPROVAL_REQUIRED | Hold for a human |
| **BLOCK** | `BLOCK` *(exists)* | BLOCKED | Do not proceed |
| **LOG** | `ALERT` *(exists)* | WARNING | Proceed; record signals; raise an alert only if severity ≥ the org's alert threshold |

No new enum value is needed. `ALERT` already means "allowed and flagged",
and the API and UI can present it as **LOG**.

### 1.4 What gets recorded (stage 6): extend `PolicyEvaluation`

`PolicyEvaluation` is already the immutable, snapshot-based decision record.
Rather than adding a parallel "decision" table, extend it:

```prisma
model PolicyEvaluation {
  // … existing fields unchanged …
  decisionSource   String   // CONTROL | POLICY | RISK | DEFAULT_DENY
  policyDecision   PolicyDecision          // what policy alone said
  riskScore        Int?                    // 0–100, this action
  riskBand         RiskLevel?
  signals          Json?    // [{code,label,points,evidence,source,confidence}]
  trustState       String?  // snapshot at decision time
  baselineVersion  Int?     // which AgentBaseline row was compared against
  mode             String   @default("ENFORCED") // ENFORCED | SHADOW
  shadowDecision   PolicyDecision?          // what risk WOULD have decided in shadow mode
  explanation      Json     // rendered explanation object (§6), frozen
  latencyMs        Int?
}
```

Freezing `explanation` and `signals` at decision time is what makes incident
reconstruction exact later. Policies, baselines, and trust all change, but
the record of *why this decision* doesn't.

### 1.5 Shadow mode (required, not optional)

Risk-driven escalation ships **in SHADOW first**, per org and per agent. The
decision returned is the policy decision, and `shadowDecision` records what
risk would have done. The dashboard then shows *"In the last 14 days, risk
escalation would have required approval for 37 actions (31 expected, 6
worth review)"*. That lets customers turn enforcement on with evidence
rather than faith, and it gives Aegis false-positive data to tune
thresholds.

---

## 2. Behavioral Baseline (Step 4)

### 2.1 Can the current data model support it?

| Dimension | Supported today? | Gap |
|---|---|---|
| Normal tools | **Partial.** `ActivityEvent.toolName` (only from `/events`) | `/evaluate` doesn't write it; `AgentTool` is manual and never reconciled |
| Normal APIs / destinations | **No** | No destination field; only free-text `action` / `metadata` |
| Normal data access | **Partial.** `eventType=DATA_ACCESS` plus `resource` string | No data class; resource isn't normalized into a type |
| Normal action sequences | **Weak.** `traceId` plus timestamp | `parentEventId` never written; `traceId` optional on `/events` |
| Normal frequency | **Yes.** Indexed `(agentId, timestamp)` | Computed on read with ~10 count queries |
| Normal volume (records / bytes / amount) | **No** | Only event counts and cost |
| Normal users / principals | **No** | No principal field |
| Historical anomalies | **Partial.** `SecurityAlert` | Dedupe overwrites evidence and severity |

### 2.2 Model

```prisma
// Hourly counters, the raw material. Upserted with increment in after().
model AgentActivityRollup {
  agentId        String
  organizationId String
  bucketStart    DateTime  // hour
  dimension      String    // action | namespace | tool | destination | resourceType | dataClass | principal | transition | status | total
  key            String    // e.g. "crm.export", "api.hubspot.com", "crm.read>crm.export"
  count          Int
  records        Int @default(0)
  bytes          BigInt @default(0)
  amountCents    Int @default(0)
  @@id([agentId, bucketStart, dimension, key])
  @@index([organizationId, bucketStart])
}

// Derived profile. Recomputed lazily when older than N minutes, or by a cron once one exists.
model AgentBaseline {
  id          String @id @default(cuid())
  agentId     String
  version     Int               // monotonic; referenced by PolicyEvaluation.baselineVersion
  windowDays  Int               // default 28
  maturity    String            // LEARNING | ESTABLISHED | STALE
  eventsObserved Int
  daysObserved   Int
  profile     Json              // see below
  computedAt  DateTime
  @@unique([agentId, version])
}
```

`profile` holds, per dimension:

- **Sets:** `{key, count, share, firstSeen, lastSeen}` for tools, actions,
  destinations, resource types, data classes, principals, and transitions.
- **Rates:** hourly count distribution for `total` and per sensitive
  dimension, as `median`, `MAD`, `p95`, `max`, plus an hour-of-week activity
  mask.
- **Volumes:** `records`, `bytes`, `amountCents` per action, as median and
  p95.

### 2.3 Detection methods (all explainable)

| Test | Method | Example explanation |
|---|---|---|
| **Novelty** | key ∉ set | "First time this agent sent data to `files.example-share.io`" |
| **Rarity** | share < 1% and count ≤ 2 in window | "`crm.export` is rare for this agent: 2 times in 28 days" |
| **Rate** | robust z = (x − median) / (1.4826·MAD), floor MAD ≥ 1; flag at z ≥ 4 **and** x ≥ minimum | "412 actions this hour; typical is 18–40 (p95 52)" |
| **Volume** | x > max(3 × p95, historical max) | "Requested 48,000 records; previous maximum was 1,200" |
| **Sequence** | transition `prev→current` unseen, with both actions known | "`crm.read` → `email.send_external` has never happened before" |
| **Time** | hour-of-week with zero historical activity | "Active at 03:00 Sunday; this agent has never acted at this time" |

**Maturity gating:** below `MIN_EVENTS` and `MIN_DAYS` (the same principle
as the existing `baseline.ts`), the baseline is `LEARNING`. Novelty and rate
signals are **recorded but given zero points**, and the UI says "Learning
— 3 of 7 days observed." No baseline claims are made without data.

**Anti-poisoning:**
- Only events with decision ALLOW/LOG and risk band < HIGH feed the
  baseline. BLOCKED events and events during QUARANTINE never do.
- New keys enter the set only after they're seen on ≥ 2 distinct days, so a
  single burst can't normalize itself.
- An operator's "Mark as expected" on an alert writes an explicit baseline
  allowlist entry plus a trust-ledger event with the actor. Normalization
  is auditable.

**Cost:** one `AgentBaseline` read plus a handful of current-hour rollup
rows per decision. This replaces the ~10 window-count queries that
`baseline.ts` and `security/evaluate.ts` run today.

---

## 3. Dynamic Trust (Step 5)

Trust is a **state with a ledger**, not a free-floating score.

```
UNVERIFIED ──(connection verified + baseline ESTABLISHED)──► OBSERVED
OBSERVED   ──(≥14 days, no HIGH+ incident, approval reject rate < 10 %)──► TRUSTED
any        ──(HIGH incident | policy-violation-after-the-fact | credential exposure)──► RESTRICTED
any        ──(CRITICAL incident | repeated BLOCK spike | operator)──► QUARANTINED
RESTRICTED ──(N clean days AND operator review)──► previous state
QUARANTINED ──(operator only)──► RESTRICTED
```

```prisma
model AgentTrustEvent {          // append-only ledger
  id          String @id @default(cuid())
  organizationId String
  agentId     String
  fromState   String
  toState     String   // may equal fromState (a contributing event, not a transition)
  direction   String   // UP | DOWN | NEUTRAL
  reasonCode  String   // e.g. CREDENTIAL_EXPOSURE, CLEAN_PERIOD, NEW_PERMISSION_GRANTED
  reason      String   // human sentence
  sourceType  String   // SecurityAlert | PolicyEvaluation | ApprovalDecision | AuditEvent | Operator
  sourceId    String?
  actorUserId String?
  createdAt   DateTime @default(now())
}
// Agent gets: trustState String @default("UNVERIFIED"), trustStateChangedAt DateTime?
```

**Signals feeding trust:** connection identity (verified provider key vs.
self-registered); breadth of permissions (count of ALLOW wildcards, any
`*.delete` ALLOW); tool and destination novelty rate; open alerts by
severity; policy violations after the fact; approval outcomes (rejected
approvals count against trust, approved ones are neutral); time since last
incident; and operator actions.

**Explainability contract:** the UI never shows a trust state without the
last 5 ledger entries that produced it ("RESTRICTED since Oct 3 because:
credential-shaped field sent in `crm.sync` metadata (alert #a1b2)"). If a
display number is wanted, it's derived from the state plus open
contributing events, and each contribution is listed. That follows the
existing `computeAgentRiskScore` pattern.

**What trust does:** it selects the row of the risk-response matrix (§4.3).
It never bypasses a policy BLOCK.

---

## 4. Unified Risk Engine (Step 6)

### 4.1 Signal contract

```ts
type RiskSignal = {
  code: string;            // NOVEL_DESTINATION, VOLUME_ANOMALY, SENSITIVE_DATA, …
  label: string;           // one human sentence, with numbers
  points: number;          // contribution, 0–60
  confidence: "LOW" | "MEDIUM" | "HIGH";
  source: "static" | "baseline" | "context" | "trust" | "policy";
  evidence: Record<string, unknown>;  // observed vs expected, refs to rows
  hard?: "BLOCK" | "APPROVE";         // non-negotiable outcome (rare)
};
```

Signals are **pure functions** over (envelope, baseline, context snapshot),
the same pattern as the existing `detectors.ts`. Most existing detectors
become signals with little change.

### 4.2 Signal catalogue (initial)

| Code | Source | Reuses | Default points |
|---|---|---|---|
| `STATIC_ACTION_RISK` | static | `scoreEventRisk` *(exists)* | LOW 0 / MED 10 / HIGH 25 / CRIT 40 |
| `SENSITIVE_DATA` | static | `SENSITIVE_RESOURCE_KEYWORDS` *(exists)* + `dataClass` | 10–25 |
| `DANGEROUS_TOOL` | static | new org-editable list (shell, payments, delete, prod deploy) | 20 |
| `NOVEL_ACTION` / `NOVEL_TOOL` | baseline | `detectNewSensitiveAction`, `detectNewToolUsage` *(exist)* | 10 / 8 |
| `NOVEL_DESTINATION` | baseline | new | 20 (30 if sensitive data) |
| `RATE_ANOMALY` | baseline | `detectActivityVolumeSpike` logic *(exists)* moved to rollups | 15–30 |
| `VOLUME_ANOMALY` | baseline | new | 20–40 |
| `UNUSUAL_SEQUENCE` | baseline | new | 15 |
| `OFF_HOURS` | baseline | new | 5 |
| `RECENT_BLOCKS` | context | `detectBlockSpike` *(exists)* | 10–20 |
| `OPEN_ALERTS` | context | `computeAgentRiskScore` factors *(exists)* | 0–20 |
| `PROMPT_INJECTION_INDICATOR` | context | *(exists)*, LOW confidence | 5 |
| `CREDENTIAL_IN_PAYLOAD` | context | *(exists)* | `hard: APPROVE` |
| `EXFIL_PATTERN` | composite | SENSITIVE_DATA ∧ (NOVEL_DESTINATION ∨ VOLUME_ANOMALY) | `hard: APPROVE` (BLOCK if trust ≤ RESTRICTED) |

Points are org-tunable later (P2). Defaults live in code, as plain data,
like `RULES` in `risk-scoring.ts`.

### 4.3 Combiner

```
riskScore = min(100, Σ points × confidenceWeight)     // LOW conf ×0.5
riskBand  = LOW <20 ≤ MEDIUM <45 ≤ HIGH <70 ≤ CRITICAL

riskDecision = matrix[trustState][riskBand]   // org-configurable, defaults below
               overridden by any signal.hard
final        = strictest(controlGate, policyDecision, riskDecision)   // SEVERITY map exists in resolver.ts
decisionSource = whichever stage produced `final`
```

Default matrix:

| trust \ band | LOW | MEDIUM | HIGH | CRITICAL |
|---|---|---|---|---|
| TRUSTED | ALLOW | ALLOW | LOG | APPROVE |
| OBSERVED | ALLOW | LOG | APPROVE | APPROVE |
| UNVERIFIED | ALLOW | LOG | APPROVE | BLOCK |
| RESTRICTED | LOG | APPROVE | APPROVE | BLOCK |
| QUARANTINED | APPROVE | APPROVE | BLOCK | BLOCK |

**Every decision has an explanation** because each stage contributes
structured reasons: control state, the winning policy *(exists in
`resolveDecision`)*, the signals ranked by points, and the trust state with
its latest ledger reason.

---

## 5. Action Graph (Step 7)

A **read model**, assembled from existing tables plus the new envelope
fields. It isn't a new source of truth, and it isn't a graph database.

```
Principal(user/on-behalf-of) ─requested→ Agent ─ran→ Task(taskId) ─contains→ Trace(traceId)
   Trace ─step→ Step(ActivityEvent, ordered by timestamp, parentEventId tree)
   Step ─used→ Tool(toolName) ─called→ Destination(destination) ─touched→ Data(resource type, dataClass, volume)
   Step ─decided-by→ Decision(PolicyEvaluation) ─held-by→ Approval ─resolved-by→ Human
   Step ─raised→ Alert(SecurityAlert)            Step ─result→ Outcome(status, error, durationMs)
```

- **Build:** `getActionGraph(orgId, {traceId | taskId | agentId+window})`
  does about 5 indexed queries, then pure assembly. Unit-testable like the
  detectors.
- **Storage changes needed:** write `parentEventId` and the envelope fields;
  add `activityEventId` (nullable FK) to `SecurityAlert` and keep `traceId`;
  add `executedEventId` to `ApprovalRequest` for the approval → execution
  link.
- **UI:** a per-trace vertical "swimlane" (Agent → Tool → Destination →
  Data), not a force-directed hairball. Each node shows observed metadata
  only. `description` is the caller's own summary and is labeled "reported
  by agent".
- **Not included:** prompts, completions, reasoning text. If an integration
  sends them in `metadata`, they stay behind a "raw metadata" disclosure
  and are redacted (*exists*) the same as today.

---

## 6. Incident Reconstruction (Step 8)

```prisma
model Incident {                    // a container, not a copy of the data
  id, organizationId, agentId
  status        OPEN | INVESTIGATING | RESOLVED | FALSE_POSITIVE
  severity      SecurityAlertSeverity
  anchorType    SecurityAlert | PolicyEvaluation
  anchorId      String
  traceIds      String[]
  windowStart   DateTime
  windowEnd     DateTime
  title         String
  resolutionNote String?
  createdAt, resolvedAt, resolvedByUserId
}
```

**Creation:** automatic for any BLOCK whose `decisionSource ∈ {RISK,
CONTROL}`, any CRITICAL alert, or any `POLICY_VIOLATION_DETECTED`. Manual
from any alert or evaluation. Related alerts within the same trace or a
15-minute agent window attach to the open incident instead of creating new
ones. This also fixes the current dedupe-overwrite problem: occurrences
become separate rows grouped by the incident.

**Timeline = merge-sort of real rows**, each line linking to its source:

| Line | Source row |
|---|---|
| 10:42:03 Task `t_91` started (reported) | ActivityEvent `agent.started` |
| 10:42:04 Tool `crm` selected → `crm.query customers` | ActivityEvent TOOL_CALL |
| 10:43:10 Sensitive data accessed: 48,000 `pii` records | ActivityEvent DATA_ACCESS + volume |
| 10:43:11 Deviation: volume 40× p95; novel destination | PolicyEvaluation.signals (frozen) |
| 10:43:11 Risk 82 (CRITICAL); trust OBSERVED | PolicyEvaluation.riskScore / trustState |
| 10:43:11 Policy "External exports" evaluated → APPROVE | PolicyEvaluation.matchedPolicySnapshots |
| 10:43:11 Decision BLOCK (risk matrix, EXFIL_PATTERN) | PolicyEvaluation.decision / decisionSource |
| 10:43:12 Agent reported `crm.export` not executed | ActivityEvent with `decision.honored` (§7) |
| — no further events for this trace — | explicit gap marker |
| 10:47 A SECURITY-role member moved agent to RESTRICTED | AuditEvent + AgentTrustEvent |

Rules: no interpolation; gaps longer than the trace's median step interval
render as "No telemetry received for 4m 12s"; and every line shows its
provenance (`reported by agent`, `decided by Aegis`, `human action`).

---

## 7. The Aegis Moment — "Aegis stopped this" (Step 9)

### 7.1 Card

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⛔ ACTION BLOCKED                         support-agent · 10:43:11 │
│  Agent attempted:  EXPORT CUSTOMER RECORDS   (crm.export)           │
│  Risk: CRITICAL (82)        Trust: OBSERVED                         │
│                                                                      │
│  Why                                                                  │
│   • 48,000 records requested; this agent's max is 1,200   (+35)      │
│   • First time sending data to files.example-share.io      (+30)     │
│   • Customer PII (dataClass: pii)                          (+15)     │
│   • Policy "External exports" requires approval            (policy) │
│                                                                      │
│  What Aegis did:   Returned BLOCK to the agent.                       │
│  Enforcement:      ✓ Agent confirmed it did not run the action (10:43:12)│
│                    — or —  ⚠ Not confirmed: no acknowledgement received │
│  If allowed:       48,000 customer records sent to files.example-share.io│
│                    (from the request's own parameters)                │
│                                                                      │
│  [View incident]  [Mark as expected]  [Restrict agent]               │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.2 Truthfulness rules

- **"What Aegis did"** is always literal: "Returned BLOCK", "Held for
  approval", "Recorded".
- **"Enforcement"** shows ✓ only with evidence. V2 SDK adds
  `aegis.guard(input, fn)`, which calls `authorize`, runs `fn` only on
  ALLOW or approved, and reports `decision.honored` / `decision.executed`
  with the same `evaluationId`. Without that acknowledgement the card says
  "Not confirmed". This uses the existing `EnforcementOutcome` vocabulary.
- **"If allowed"** appears **only** when the consequence can be stated from
  the request's own fields (`volume.records`, `destination`,
  `volume.amountCents`, `resource`). Otherwise the line is omitted rather
  than guessed.

### 7.3 Where it shows up

1. A real-time banner on Overview, plus a "Stopped by Aegis" feed.
2. Agent page header ("Aegis stopped 3 actions this week").
3. Webhook `decision.blocked` carrying the same explanation object.
4. A weekly digest (in-app first; email when a provider exists): *"Aegis
   stopped 12 actions, held 31 for approval, and learned 4 new normal
   destinations."* This is the retention artifact: it proves value without
   the customer opening the app.
5. Shadow mode variant: **"Aegis would have stopped this"**, which
   converts trial users to enforcement.
