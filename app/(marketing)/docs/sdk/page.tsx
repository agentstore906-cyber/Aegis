import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";
import { CodeBlock } from "@/components/ui/code-block";

export const metadata: Metadata = {
  title: "SDK Reference",
  description: "@aegis/agent-sdk — install, initialize, track activity, and ask for authorization.",
};

const INSTALL = `npm install @aegis/agent-sdk`;

const INIT = `import { Aegis } from "@aegis/agent-sdk";

const aegis = new Aegis({
  apiKey: process.env.AEGIS_API_KEY!,
  baseUrl: process.env.AEGIS_BASE_URL!, // e.g. "https://app.yourcompany.com"
});`;

const TRACK = `await aegis.track({
  agent: "finance-agent",
  eventType: "TOOL_CALL",
  action: "invoice.read",
  resource: "invoice",
  status: "SUCCESS",
  metadata: { invoiceId: "inv_123" },
});`;

const AUTHORIZE = `const auth = await aegis.authorize({
  agent: "finance-agent",
  action: "refund.issue",
  resource: "payment",
  context: { amount: 1250 },
});

if (auth.decision === "BLOCK") {
  throw new Error("Action blocked by Aegis");
}

if (auth.decision === "REQUIRE_APPROVAL") {
  const approval = await aegis.waitForApproval({
    approvalRequestId: auth.approvalRequestId,
  });
  if (approval.status !== "APPROVED") {
    throw new Error(\`Action not approved: \${approval.status}\`);
  }
}

await issueRefund(); // your code always makes the final call`;

export default function SdkDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="SDK reference"
      description="A small, zero-dependency TypeScript client for real agent processes. Server-side only — never ship an API key to a browser."
    >
      <h2>Install</h2>
      <CodeBlock code={INSTALL} language="bash" />

      <h2>Initialize</h2>
      <CodeBlock code={INIT} language="typescript" />
      <p>Get an API key from your Aegis dashboard&rsquo;s Developers → API Keys.</p>

      <h2>Report an event</h2>
      <p><code>track()</code> reports an action your agent already took — it does not ask permission.</p>
      <CodeBlock code={TRACK} language="typescript" />

      <h2>Ask for authorization</h2>
      <p>
        <code>authorize()</code> asks Aegis for a decision before your agent acts. The result is a discriminated
        union on <code>decision</code> (<code>&quot;ALLOW&quot;</code> | <code>&quot;BLOCK&quot;</code> |{" "}
        <code>&quot;REQUIRE_APPROVAL&quot;</code>), so TypeScript narrows the rest of the fields once you check it.
        The SDK never executes anything on your behalf — your code always makes the final call:
      </p>
      <CodeBlock code={AUTHORIZE} language="typescript" />

      <h2>Waiting for a human decision</h2>
      <p>
        <code>waitForApproval()</code> polls with capped backoff (starts at 1s, caps at 5s) and gives up after a
        timeout (default 120s) — it never waits forever unless you explicitly ask it to. Throws a timeout error if
        the request is still pending when the deadline passes.
      </p>

      <h2>Registering an agent</h2>
      <p>
        <code>registerAgent()</code> skips a dashboard visit for a brand-new agent. Idempotent by name — calling it
        again returns the same agent rather than creating a duplicate.
      </p>

      <h2>Errors</h2>
      <p>
        Typed errors distinguish authentication failures, rate limits, validation errors, network errors, and
        timeouts. Transient failures (429, 5xx, network errors) are retried automatically with bounded exponential
        backoff; other 4xx errors are never retried.
      </p>

      <h2>Idempotency</h2>
      <p>
        Pass <code>idempotencyKey</code> to <code>authorize()</code> to make a retried call safe — the same key with
        an equivalent request replays the original decision instead of creating a second approval request.
      </p>
    </DocPage>
  );
}
