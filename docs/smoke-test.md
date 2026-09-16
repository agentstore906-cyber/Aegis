# Production smoke test

A repeatable manual pass through the core flow, meant to be run by a
human in a few minutes before a demo or after a deploy. Each step names
the actual route/action it exercises — not a hypothetical one.

1. **Create account** — `/sign-up`. Confirm redirect to `/onboarding`.
2. **Create organization** — the onboarding wizard's "Create your
   workspace" step. Confirm redirect to `/onboarding/connect`.
3. **Connect agent** — "Connect an Agent" → `/agents/new`. Choose
   **Custom Agent**, name it, click Connect. Confirm the "Agent
   connected" screen shows a one-time API key, the new agent appears at
   `/agents`, and its detail page loads with a "Connection" card showing
   `Connected`. (Optionally also smoke-test **OpenAI**/**Anthropic** with
   a real key to confirm discovery/verification against the live API.)
4. **Send event** — using the API key shown on the connect screen (or
   create another at `/developers/api-keys`) and the app's base URL
   (shown at `/developers`), `POST /api/v1/events` (or
   `@aegis/agent-sdk`'s `track()`). Confirm the event appears at
   `/activity` and the agent page stops showing "waiting for the first
   activity".
5. **Create policy** — `/policies/new`. Create a rule requiring approval
   above some threshold for an action. Confirm it appears at `/policies`
   as `ACTIVE`.
6. **Evaluate action** — `/policies/test`, or `POST /api/v1/evaluate`
   with a value that should trip the policy. Confirm the response is
   `REQUIRE_APPROVAL` with an `approvalRequestId`.
7. **Trigger approval** — confirms itself as part of step 6 (evaluating
   to `REQUIRE_APPROVAL` is what creates the request).
8. **Approve action** — `/approvals`, open the pending request, Approve
   with a comment. Confirm status flips to `APPROVED`.
9. **Verify audit** — `/audit`, confirm entries exist for: agent
   connected, policy created, approval requested, approval approved —
   all sharing a recognizable trace.
10. **Verify activity** — `/activity`, confirm the original event and
    the `approval.approve` system event both appear, linked by trace id.
11. **Verify cost** — if the sent event included a `cost` field,
    `/costs` should reflect it in that agent's spend for today.
12. **Verify security** — `/security`; if the evaluated action was the
    agent's first high-risk action, a `NEW_SENSITIVE_ACTION` alert
    should appear. (Not every smoke-test run will trip a detector —
    that's expected, not a failure, unless you deliberately chose an
    action designed to trip one.)
13. **Disconnect / reconnect** — on the agent's detail page, click
    Disconnect on the Connection card. Confirm its status flips to
    `Disconnected`, historical activity in `/activity` is unchanged, and
    a further `POST /api/v1/events` for that agent is rejected with
    `AGENT_CONNECTION_DISCONNECTED`. Click Reconnect (a fresh API key for
    Custom Agent, or a valid credential for OpenAI/Anthropic) and confirm
    status returns to `Connected`.

All 13 steps are also covered by automated integration tests
(`npm test`) exercising the same functions against a real database — run
this manual pass to confirm the same behavior holds through the actual
UI and HTTP layer, not just the underlying functions.
