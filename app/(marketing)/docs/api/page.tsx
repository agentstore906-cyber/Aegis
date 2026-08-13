import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";
import { CodeBlock } from "@/components/ui/code-block";

export const metadata: Metadata = {
  title: "API Reference",
  description: "Every Aegis public API endpoint: authentication, requests, responses, and error codes.",
};

const AUTH_HEADER = `Authorization: Bearer aegis_live_9f3a2b1c...`;

const EVALUATE_REQUEST = `POST /api/v1/evaluate

{
  "agent": "finance-agent",
  "action": "refund.issue",
  "resource": "payment",
  "context": { "amount": 1250, "currency": "USD" }
}`;

const EVALUATE_RESPONSE = `{
  "decision": "REQUIRE_APPROVAL",
  "evaluationId": "eval_...",
  "approvalRequestId": "apr_...",
  "traceId": "trace_456"
}`;

const ERROR_SHAPE = `{
  "error": { "code": "INVALID_REQUEST", "message": "The field \`action\` is required." }
}`;

export default function ApiDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="API reference"
      description="app/api/v1/* — the endpoints a real external agent process uses to authenticate, report activity, ask for a decision, and poll an approval."
    >
      <h2>Authentication</h2>
      <p>
        Every request needs an API key, created from Developers → API Keys in the dashboard. Keys are
        organization-scoped — a request acts as the organization that created the key, and can only ever reference
        that organization&rsquo;s agents, evaluations, and approvals.
      </p>
      <CodeBlock code={AUTH_HEADER} language="text" />

      <h2>Endpoints</h2>
      <h3><code>POST /api/v1/events</code></h3>
      <p>
        Reports an action your agent already took (does not ask permission — see <code>/evaluate</code> for that).
        Requires only <code>agent</code>, <code>eventType</code>, and <code>action</code>; everything else
        (<code>resource</code>, <code>status</code>, <code>traceId</code>, <code>durationMs</code>,{" "}
        <code>model</code>, <code>provider</code>, <code>cost</code>, <code>metadata</code>) is optional. Returns{" "}
        <code>201</code> with the created event&rsquo;s id and trace id.
      </p>

      <h3><code>POST /api/v1/evaluate</code></h3>
      <p>Asks whether an agent may perform an action. The response shape depends on the decision:</p>
      <CodeBlock code={EVALUATE_REQUEST} language="json" />
      <CodeBlock code={EVALUATE_RESPONSE} language="json" />
      <p>
        If the decision is <code>REQUIRE_APPROVAL</code>, the approval request and its audit event already exist by
        the time this responds. A <code>BLOCK</code> response includes a human-readable <code>reason</code>.
      </p>

      <h3><code>GET /api/v1/approvals/:id</code></h3>
      <p>
        Polls an approval request&rsquo;s current status: <code>PENDING</code>, <code>APPROVED</code>,{" "}
        <code>REJECTED</code>, <code>EXPIRED</code>, or <code>CANCELLED</code>. There is no push/webhook mechanism
        for this yet — poll until status is no longer <code>PENDING</code> (the SDK&rsquo;s{" "}
        <code>waitForApproval()</code> does this for you).
      </p>

      <h3><code>POST /api/v1/agents/register</code></h3>
      <p>
        Optional convenience so a brand-new agent doesn&rsquo;t need a dashboard visit before its first event or
        evaluation. Idempotent by name — calling it again returns the same agent rather than creating a duplicate.
      </p>

      <h2>Errors</h2>
      <p>Every error response has the same shape:</p>
      <CodeBlock code={ERROR_SHAPE} language="json" />
      <p>
        Common codes: <code>MISSING_API_KEY</code>, <code>INVALID_API_KEY</code>, <code>REVOKED_API_KEY</code>,{" "}
        <code>EXPIRED_API_KEY</code> (401); <code>INSUFFICIENT_SCOPE</code> (403); <code>RATE_LIMITED</code> (429);{" "}
        <code>INVALID_REQUEST</code>, <code>PAYLOAD_TOO_LARGE</code> (400/413); <code>AGENT_NOT_FOUND</code>,{" "}
        <code>APPROVAL_NOT_FOUND</code> (404); <code>IDEMPOTENCY_KEY_CONFLICT</code> (409);{" "}
        <code>INTERNAL_ERROR</code> (500, never leaks a stack trace).
      </p>

      <h2>Rate limiting</h2>
      <p>
        60 requests/minute per API key. A rate-limited response includes a <code>Retry-After</code> header, plus{" "}
        <code>x-ratelimit-limit</code> and <code>x-ratelimit-remaining</code>.
      </p>

      <h2>Idempotency</h2>
      <p>
        Pass an <code>Idempotency-Key</code> header on <code>/events</code>, <code>/evaluate</code>, or{" "}
        <code>/agents/register</code> to make a retry safe — the same key with an equivalent body replays the
        original response instead of creating a duplicate. The same key with a different body is rejected as a
        caller error.
      </p>

      <h2>Key format</h2>
      <p>
        Keys look like <code>aegis_live_&lt;secret&gt;</code>. Only a hash of the key is ever stored — the full value
        is shown exactly once, at creation, and can&rsquo;t be retrieved again. Never ship an API key to a browser.
      </p>
    </DocPage>
  );
}
