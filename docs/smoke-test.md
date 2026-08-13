# Production smoke test

A repeatable manual pass through the core flow, meant to be run by a
human in a few minutes before a demo or after a deploy. Each step names
the actual route/action it exercises — not a hypothetical one.

1. **Create account** — `/sign-up`. Confirm redirect to `/onboarding`.
2. **Create organization** — the onboarding wizard's "Create your
   workspace" step. Confirm redirect to `/onboarding/connect`.
3. **Create agent** — "Connect an Agent" → `/agents/new`. Confirm the
   new agent appears at `/agents` and its detail page loads.
4. **Create API key** — `/developers/api-keys` → Create key. Confirm the
   raw key is shown exactly once and copyable.
5. **Send event** — using the copied key and the app's base URL (shown
   at `/developers`), `POST /api/v1/events` (or `@aegis/agent-sdk`'s
   `track()`). Confirm the event appears at `/activity`.
6. **Create policy** — `/policies/new`. Create a rule requiring approval
   above some threshold for an action. Confirm it appears at `/policies`
   as `ACTIVE`.
7. **Evaluate action** — `/policies/test`, or `POST /api/v1/evaluate`
   with a value that should trip the policy. Confirm the response is
   `REQUIRE_APPROVAL` with an `approvalRequestId`.
8. **Trigger approval** — confirms itself as part of step 7 (evaluating
   to `REQUIRE_APPROVAL` is what creates the request).
9. **Approve action** — `/approvals`, open the pending request, Approve
   with a comment. Confirm status flips to `APPROVED`.
10. **Verify audit** — `/audit`, confirm entries exist for: policy
    created, approval requested, approval approved — all sharing a
    recognizable trace.
11. **Verify activity** — `/activity`, confirm the original event and
    the `approval.approve` system event both appear, linked by trace id.
12. **Verify cost** — if the sent event included a `cost` field,
    `/costs` should reflect it in that agent's spend for today.
13. **Verify security** — `/security`; if the evaluated action was the
    agent's first high-risk action, a `NEW_SENSITIVE_ACTION` alert
    should appear. (Not every smoke-test run will trip a detector —
    that's expected, not a failure, unless you deliberately chose an
    action designed to trip one.)

All 13 steps are also covered by automated integration tests
(`npm test`) exercising the same functions against a real database — run
this manual pass to confirm the same behavior holds through the actual
UI and HTTP layer, not just the underlying functions.
