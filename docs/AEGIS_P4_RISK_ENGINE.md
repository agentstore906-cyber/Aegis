# Aegis P4 — Unified Risk Engine (shadow mode)

P1 gave Aegis structured telemetry, P2 gave each agent a behavioral baseline, P3 gave each agent a trust state. P4 combines what they know — together with policy and the request itself — into **one explainable risk assessment per authorization decision**, and compares what that assessment *would* have decided with what Aegis *actually* decided.

> **P4 is shadow only.** The risk assessment is computed and stored next to every evaluation. It never changes `decision`, never creates an approval, never blocks, and is not returned to the calling agent. Production risk enforcement is **off**, and there is no flag that turns it on — enforcement would be a deliberate later change.

Code: `lib/risk/*` · Wiring: `lib/policies/evaluate.ts` · UI: `components/risk/risk-assessment-card.tsx` on the evaluation detail page · Migration: `20261005120000_p4_risk_engine` · Tests: `lib/risk/__tests__/*`, `lib/__tests__/p4-risk-engine.integration.test.ts`.

## Pipeline

```
ACTION REQUEST   POST /api/v1/evaluate (or the dashboard policy tester)
      ↓
CONTEXT          trusted server-side environment / risk floor; telemetry (P1)      decision-context.ts
      ↓
POLICY           permissions + policies → ALLOW / ALERT / REQUIRE_APPROVAL / BLOCK  matcher.ts, resolver.ts
      ↓
BEHAVIOR         the request dry-run against the latest stored baseline (P2)        risk/context.ts → behavior/detect.ts
      ↓
TRUST            the agent's stored trust state (P3)                                risk/context.ts
      ↓
RISK SIGNALS     one signal per piece of real evidence, with evidence attached      risk/signals.ts
      ↓
RISK EVALUATION  deterministic composition → level + reasons                        risk/compose.ts  composeRisk()
      ↓
DECISION         the real decision (unchanged) + shadow comparison                  evaluate.ts, compose.ts buildShadow()
```

The evidence queries start *before* the policy queries and run in parallel with them, so the added latency is normally the slower of the two, not their sum. The decision path is protected: the context load has a 1.5 s cap (`RISK_CONTEXT_TIMEOUT_MS`); on timeout or error the evaluation proceeds and is recorded **without** an assessment (a structured `risk_context_timeout` / `risk_context_failed` / `risk_compose_failed` line is logged). A risk-engine failure can never fail or alter a decision.

The context load is **read-only**. Unlike the after-response behavior observer it never computes or writes a baseline; it uses the latest one already stored.

## Risk signals

Every signal is built from telemetry Aegis actually has. A missing input produces *no* signal and a context note — never an invented one.

| Signal | Family | Evidence it rests on | Severity |
|---|---|---|---|
| `policy_violation` | policy | An **explicit** policy/permission resolved this action to `BLOCK` or `ALERT` | BLOCK → HIGH; ALERT → the policy's own severity (CRITICAL → HIGH) |
| `sensitive_data` | request | P1 data classes / declared sensitivity | HIGH data → MEDIUM; CRITICAL (health, credentials) → HIGH |
| `high_risk_action` | request | The existing keyword rule (`lib/security/risk-scoring.ts`) matched the action name | rule CRITICAL → MEDIUM; rule HIGH → LOW; lower → no signal |
| `new_destination` | behavior | P2 `NEW_DESTINATION` deviation (dry run) | MEDIUM, capped by detector confidence |
| `unusual_volume` | behavior | P2 `UNUSUAL_VOLUME` deviation (records/bytes vs p95) | MEDIUM, capped by confidence |
| `unusual_sequence` | behavior | P2 `UNUSUAL_SEQUENCE` (parent→child action transition) | MEDIUM, capped by confidence |
| `behavioral_deviation` | behavior | Any other P2 deviation: `NEW_TOOL`, `UNUSUAL_DATA_TYPE` (MEDIUM); `NEW_SERVICE`, `NEW_ACTION_TYPE`, `NEW_END_USER`, `UNUSUAL_FREQUENCY`, `UNUSUAL_TIME` (LOW) | capped by confidence |
| `trust_degradation` | history | The stored P3 trust state | DEGRADED → MEDIUM; HIGH_RISK / RESTRICTED → HIGH; TRUSTED / NORMAL → none |
| `historical_incident` | history | Prior `BLOCK`/`ALERT` evaluations (kill-switch refusals excluded) and rejected approvals for the **same agent and same action** in the last 14 days | 1 prior → LOW; 2+ → MEDIUM |

**Why the severities are what they are** (all in `lib/risk/config.ts`, each with its rationale):

- Deviations that change *where data can go, what can be touched, or how much leaves* are MEDIUM — they are the shapes exfiltration and misuse take. Deviations that are merely indicators (a new end user, an odd hour) are LOW — they are common in legitimate use.
- A deviation's severity is capped by the detector's own confidence, so an agent with limited history (LOW-confidence deviations) can never push the level above LOW.
- The keyword rule is the weakest evidence Aegis has (it matches words in an action name the agent chose), so it can only nudge.
- Default-deny (no rule matched) and `REQUIRE_APPROVAL` are not "violations": one is the absence of a rule, the other a review gate, and both are already enforced.

**Not implemented — "dangerous tool".** The brief listed it as a possible signal, but Aegis has no tool-risk classification telemetry, and inventing one would break the "no unsupported signals" rule. What exists is covered elsewhere: a tool the agent does not normally use (`NEW_TOOL`) and a dangerous-looking *action* (`high_risk_action`). A real tool classification (e.g. a per-tool risk level set by operators) is the right future input.

## Composition methodology

There are **no numeric weights.** Severities are an ordinal scale (LOW < MEDIUM < HIGH). Nothing in Aegis's telemetry supports claiming one signal is "2.3× as risky" as another, and an arbitrary weighted sum would be impossible to explain to the person reading an approval. Three rules, applied in order:

1. **Base** — the level is the most severe signal; no signals → LOW. Weak evidence can never lower the level, and many weak signals never add up to a strong one.
2. **Corroborate** — if **two or more independent families** (policy, request, behavior, history) each hold a MEDIUM-or-higher signal, the level rises **one step, once** (LOW→MEDIUM→HIGH→CRITICAL, capped).
   - *Why families:* signals inside a family are correlated (a new destination usually brings a new service; trust and historical incidents are both derived from the same past events), so they never compound each other. Only agreement across *different kinds* of evidence does.
   - *Why two and one step:* two is the smallest number that is "independent evidence agreeing" rather than one source repeating itself; more than one step would let weakly-independent evidence reach CRITICAL.
3. **Map** — level → the decision it argues for:

   | Level | Risk decision |
   |---|---|
   | LOW | ALLOW |
   | MEDIUM | ALERT |
   | HIGH | REQUIRE_APPROVAL |
   | CRITICAL | REQUIRE_APPROVAL |

   `BLOCK` is deliberately unreachable from risk alone: blocking stays with explicit policy and the kill switch until shadow data shows the engine's precision. CRITICAL records the extra severity in the level without changing the mapped decision.

Pure and deterministic — identical inputs produce an identical assessment (tested). Changing any rule requires bumping `RISK_METHODOLOGY_VERSION`, which is stored on every assessment.

The spec example: *new destination (behavior, MEDIUM) + sensitive data (request, MEDIUM) + 8× normal volume (behavior, MEDIUM) + degraded trust (history, MEDIUM)* → base MEDIUM, three families agree → **HIGH**.

## Explanation format

Stored as JSON in `policy_evaluations.riskAssessment` (type `RiskAssessment`, `lib/risk/types.ts`):

```jsonc
{
  "methodologyVersion": 1,
  "level": "HIGH",
  "headline": "HIGH RISK — 3 independent kinds of evidence agree.",
  "reasons": [                       // most severe first; rank is 1-based
    {
      "rank": 1, "code": "new_destination", "family": "behavior", "severity": "MEDIUM",
      "summary": "New destination: \"files.unknown.example\" was not part of this agent's normal destinations.",
      "evidence": [{ "source": "behavioral_deviation",
                     "detail": { "kind": "NEW_DESTINATION", "confidence": "HIGH", "observed": {…}, "expected": {…},
                                 "explanation": "…", "baselineVersion": 3, "baselineMaturity": "ESTABLISHED" } }]
    },
    { "rank": 2, "code": "unusual_volume", "summary": "Unusual volume: 80 records — 8× its 95th percentile.", … },
    { "rank": 3, "code": "sensitive_data", "summary": "Sensitive data: this request involves HIGH sensitivity data (PII).", … },
    { "rank": 4, "code": "trust_degradation", "summary": "Agent trust degraded: DEGRADED (score 52/100).",
      "evidence": [{ "source": "trust_state", "detail": { "state": "DEGRADED", "score": 52, "evaluatedAt": "…", "topFactors": […] } }] }
  ],
  "escalation": { "applied": true, "corroboratingFamilies": ["behavior","request","history"], "from": "MEDIUM", "to": "HIGH" },
  "context": {
    "baseline": { "status": "used", "version": 3, "maturity": "ESTABLISHED", "computedAt": "…" },
    "trust":    { "status": "used", "state": "DEGRADED", "score": 52, "evaluatedAt": "…" },
    "notes": []                       // what could NOT be known — see below
  },
  "shadow": { "actual": "ALLOW", "riskDecision": "REQUIRE_APPROVAL", "recommended": "REQUIRE_APPROVAL",
              "outcome": "WOULD_ESCALATE",
              "summary": "Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL." }
}
```

Every reason carries evidence that references real data: a policy or permission id, a deviation's observed/expected values and baseline version, the trust state and score, or the ids of the prior evaluations / approvals. `formatAssessment()` renders the same content as plain text:

```
HIGH RISK — 3 independent kinds of evidence agree.

Reasons:
1. New destination: "files.unknown.example" was not part of this agent's normal destinations.
2. Unusual volume: 80 records — 8× its 95th percentile.
3. Sensitive data: this request involves HIGH sensitivity data (PII).
4. Agent trust degraded: DEGRADED (score 52/100).

Escalated MEDIUM → HIGH: independent evidence from behavior, request, history agrees.

Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL.
```

**Missing context** is stated, never treated as safe: `context.notes` can contain `baseline_unavailable`, `baseline_new_agent`, `baseline_limited_history`, `trust_unavailable`, `trust_stale` (stored evaluation > 1 h old; still used) and `data_classification_not_reported`.

## Shadow decision

`buildShadow()` compares the risk level's decision with what actually happened:

| `outcome` | Meaning |
|---|---|
| `AGREES` | Risk's own decision equals the actual decision |
| `WOULD_ESCALATE` | Risk is stricter than what actually happened — **this is the shadow signal** to study |
| `ACTUAL_STRICTER` | The actual decision (policy, default-deny, kill switch) was already stricter than risk alone |
| `SUPPRESSED` | Risk is stricter, but a consumed human approval holds the recommendation at `actual` |

Rules: `recommended` is **never weaker than `actual`** — the engine only argues for more caution. A request whose actual decision is `ALLOW` *because a human approved that exact request* (`decisionSource = APPROVAL`) is not second-guessed: the level and reasons are still stored and shown, but `recommended = actual`, `suppressedBy = HUMAN_APPROVAL`. A shadow engine that overruled people who already looked would only teach them to ignore it. An explicit policy `ALLOW` does **not** suppress risk — allowed-by-policy plus risky behavior is exactly what the engine exists to surface.

The shadow comparison is computed inside the evaluation transaction, after approval consumption has settled the final decision.

## Storage

One record, no second table. Four nullable columns on `policy_evaluations`, written with the INSERT (the table is append-only by trigger, so an assessment can never be rewritten — tested):

- `riskAssessment` (JSON, the full explanation above)
- `riskAssessedLevel`, `riskRecommendedDecision`, `riskShadowOutcome` (scalar mirrors, indexed on `(organizationId, riskShadowOutcome, createdAt)` for calibration queries)

No backfill: older decisions were made without the engine. Rows with null columns are either pre-P4 or had an unavailable assessment (see above). The `/api/v1/evaluate` response is unchanged and does **not** include the assessment — returning detection logic to a possibly-compromised agent would teach it how to stay under the line. Operators see it on the evaluation detail page (`/policies/evaluations/:id`). `PolicyEvaluationResult.riskAssessment` is available to in-process callers and tests.

Calibration, per organization:

```sql
SELECT "riskShadowOutcome", "riskAssessedLevel", count(*)
FROM policy_evaluations
WHERE "organizationId" = $1 AND "createdAt" > now() - interval '14 days' AND "riskAssessment" IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
```

## Tenant isolation

Every evidence query filters on `organizationId` **and** `agentId`; a mismatched pair reads nothing (tested in both directions, including another tenant's identical action names and incident rows). The assessment reads only the evaluating tenant's baseline, trust, evaluations and approvals, and is stored under the evaluation's own `organizationId`.

## Limitations

- **Advisory and uncalibrated.** The ordinal thresholds are reasoned judgments (documented above), not fitted to outcomes. That is what the shadow period is for: study `WOULD_ESCALATE` rows with operators before any enforcement.
- **Baseline freshness.** The latest *stored* baseline is used; it is never refreshed on the decision path. It can be up to a day old (P2 computes one per UTC day via ingest/evaluate observation and the daily cron). An agent with no stored baseline yet gets no behavioral comparison, and says so.
- **Dry-run, not de-duplicated.** P2 records one deviation row per (agent, kind, subject, UTC day); the assessment evaluates *every* request, so a new destination is flagged on each request until the baseline learns it. The frequency check counts this request as one extra event in the current hour; whether it would execute is unknown.
- **Trust is read, not recomputed**, so a stale stored state (decay not yet applied) can overstate risk; a note appears after an hour.
- **Overlapping history.** `historical_incident` and `trust_degradation` can draw on the same past events; they are one family precisely so they are never counted as independent corroboration.
- **Self-reported and keyword inputs.** Data sensitivity comes from what the agent reports (a missing report is a note, not a signal); `high_risk_action` is a word match on the action name. Both are weak by design and can only nudge.
- **Only authorization decisions** are assessed. Events an agent reports after the fact (`POST /api/v1/events`) have no decision to compare against and get P2/P3 treatment only.
- **No "dangerous tool" signal** (no tool classification telemetry exists) and no cross-agent / organization-wide signals.
- **Assessments can be missing** when the evidence load times out or fails; that is a visible log line, not a silent gap, but the row itself carries nothing.

## Decisions for the product owner

1. **When to enforce.** Suggested gate: review `WOULD_ESCALATE` rows per organization for a fixed period and require a stated precision before turning on even `REQUIRE_APPROVAL` for HIGH. Enforcement should be opt-in per organization and per level.
2. **Should BLOCK ever come from risk?** Currently unreachable by design.
3. **Show the assessment on approval requests?** It would help the human decide, but it is a UI change on a security-sensitive screen, so it was left out of P4.
4. **Per-tool risk classification** to enable a genuine "dangerous tool" signal.
