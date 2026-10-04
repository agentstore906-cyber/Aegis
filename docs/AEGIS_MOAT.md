# Aegis Moat Analysis

**The question:** after six months of using Aegis, what would a customer lose
by ripping it out, and what can't a competitor or an in-house build give
back on day one?

**Short answer:** the policy engine isn't the moat. Any competent team can
write `if action matches then BLOCK`. The moat is **accumulated, per-agent,
customer-specific history that Aegis turns into decisions**: what is normal
for *this* agent, why each past decision was made, which deviations turned
out to be expected, and how much each agent has earned the right to act
without supervision. That history only exists if Aegis was in the decision
path while it was being created. It can't be imported.

---

## 1. What exists today (verified) vs. what compounds

| Asset | Exists today? | Compounds with time? | Switching cost today | Switching cost after V2 + 6 months |
|---|---|---|---|---|
| Policies and permissions | Yes | Slowly (written once, edited rarely) | Low. Exportable and re-creatable in a day | Medium. Tuned by real decisions and shadow-mode evidence |
| Policy evaluation history (immutable snapshots) | Yes | Linearly | Low. It's a log | **High** once it carries frozen signals and explanations (compliance evidence) |
| Approval history (who approved what, and why) | Yes | Linearly | Medium | **High.** It becomes the input for auto-approval and trust |
| Audit trail | Yes | Linearly | Medium (compliance) | Medium–High |
| Behavioral baseline | **Partial.** 7-day rates computed on read, not stored | No (recomputed and forgotten) | ~Zero | **Very high.** Per-agent sets for tools, destinations, data classes, principals, sequences, and volumes, with 28+ days of history |
| Operator "this is expected" feedback | **No** | — | — | **Very high.** Encodes institutional knowledge that exists nowhere else |
| Agent trust state and ledger | **No** | — | — | **High.** Each agent's earned autonomy, with reasons |
| Incident history and reconstructions | **No** (alerts only, with lossy dedupe) | — | Low | **High.** Post-mortems, auditor evidence, pattern library |
| Action graph | **No** (`traceId` string only) | — | — | Medium. Valuable for understanding; replicable if telemetry is replicated |
| Risk intelligence (signals, weights, false-positive rates) | Detectors exist; no tuning loop | No | Low | **High** per customer; later cross-customer (§4) |
| Integration footprint (SDK in every agent's tool path) | SDK exists; `authorize()` is opt-in per call | — | Medium | **High** once `guard()` wraps every tool call |

---

## 2. The five durable moats, ranked

### 1. Per-agent behavioral memory (strongest)
A baseline is worth nothing on day 1 and a great deal on day 180. After six
months, Aegis knows that `billing-agent` talks to 3 destinations, never
touches PII, peaks at 40 actions/hour on month-end, and has never chained
`crm.read → email.send_external`. A replacement starts at zero and either
(a) runs blind for weeks or (b) floods the team with false "new behavior"
alerts. **Re-learning cost is time, which money can't compress.** That's
the definition of a moat.

*What makes it stronger:* rollups that persist (not recompute-and-forget),
28–90-day windows, anti-poisoning rules, and especially operator feedback.

### 2. Operator judgment captured as data
Every "Mark as expected", approval with comment, rejected approval, and
incident marked false-positive is **a labeled example of this customer's
risk tolerance**. Today Aegis discards most of that (alert dedupe overwrites
evidence; approvals don't feed back into anything). V2 routes all of it into
the baseline allowlist and the trust ledger. After six months the customer
has hundreds of decisions encoded that no other tool knows about, and their
security team would have to make them all again.

### 3. Earned trust (graduated autonomy)
The trust ledger turns "how much do we trust this agent?" from a meeting
into an artifact: *"TRUSTED since Aug 2: 47 clean days, 112 approvals with
0 rejections, no HIGH incidents."* That is what lets teams **reduce**
approval load over time, and reducing friction is what customers pay to
keep. Ripping Aegis out resets every agent to untrusted, which means either
re-adding human approvals everywhere or accepting unsupervised agents.
Neither is acceptable to a security owner.

### 4. Explainable decision record (compliance gravity)
Frozen explanations (policy snapshot + signals + baseline version + trust
state + enforcement acknowledgement) become the evidence auditors,
regulators, and incident reviewers ask for: "show me why the agent was
allowed to do X on March 3." The data is exportable, but the **ongoing
ability to answer that question for new decisions** leaves with Aegis.
Existing strength: `PolicyEvaluation` already snapshots. V2 extends it
rather than rebuilding it.

### 5. Being in the execution path (integration depth)
Once `aegis.guard()` wraps every consequential tool call, Aegis is a
dependency of every agent. Removing it means touching every agent's tool
layer. That's real switching cost, but it's the **weakest kind of moat** on
its own (it creates resentment if the product doesn't keep earning its
place), so it should follow from the value of 1–4, not substitute for it.

---

## 3. What is *not* a moat (don't over-invest)

- **Policy DSL sophistication.** Easy to copy; customers want fewer
  policies, not more expressive ones.
- **Dashboards and charts.** Commodity.
- **Connector count.** Necessary for adoption, copyable, and it doesn't
  compound.
- **Agent Arena public scores (feature since removed, see docs/AEGIS_AGENT_ARENA_REMOVAL.md).** A good acquisition loop, not retention.
  It scores configuration, which a competitor can replicate.
- **"AI-powered" anomaly detection.** Unexplainable scores erode the trust
  that moats 2–4 depend on. Deterministic and statistical first.
- **Prompt-injection keyword lists.** Commodity, low precision.

---

## 4. A later, network-level moat (P2, needs consent and scale)

Once many customers run baselines and give "expected / not expected"
feedback, Aegis can learn **cross-customer priors** without sharing raw
data: for example, "agents with the `support` profile rarely contact
file-sharing domains," or "destination X was marked malicious in 4 orgs
this week." This lets a new customer's day-1 experience be better than an
in-house build's. It requires explicit opt-in, aggregation thresholds, and
no raw data crossing tenants. Design for it (stable signal codes,
normalized destinations and data classes), but don't build it before there
are customers.

---

## 5. Six-month test: what the customer would lose

| If they leave Aegis after 6 months, they lose… | Recoverable? |
|---|---|
| ~180 days of per-agent normal behavior across tools, destinations, data, users, sequences, and volume | Only by waiting 6 more months |
| Hundreds of operator rulings on what is "expected" | Only by re-deciding each one |
| Each agent's earned trust state and the justification for it | Only by re-earning it (with approval load returning meanwhile) |
| Decision-level explanations for every past action (auditor evidence) | Archive only; no continuity |
| Reconstructed incidents with timelines | Archive only |
| Shadow-mode evidence that justified enabling enforcement | Must re-run |
| Policies and permissions | Yes, easily. This is why policies alone aren't the moat |

**Implication for the roadmap:** every P0 item should either (a) start
accumulating one of the compounding assets as early as possible (rollups,
frozen explanations, the trust ledger, operator feedback), or (b) make
Aegis trustworthy enough to stay in the decision path (enforcement
correctness, latency). Data that isn't captured today can't be recovered
later, so **start recording before building the UI for it**.
