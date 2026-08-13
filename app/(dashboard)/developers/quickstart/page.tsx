import type { Metadata } from "next";
import Link from "next/link";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getCurrentOrigin } from "@/lib/request-origin";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Quickstart" };

export default async function QuickstartPage() {
  await requireActiveOrganization();
  const baseUrl = await getCurrentOrigin();

  const steps: { title: string; body: React.ReactNode; code?: { language: string; code: string } }[] = [
    {
      title: "Create an API key",
      body: (
        <>
          Head to <Link href="/developers/api-keys" className="text-foreground underline">API keys</Link> and create
          one. Copy the raw key now — you won&rsquo;t be able to see it again.
        </>
      ),
    },
    {
      title: "Install the SDK",
      body: "The SDK is a small, zero-dependency TypeScript package that lives in this repository at packages/agent-sdk.",
      code: { language: "bash", code: "npm install @aegis/agent-sdk" },
    },
    {
      title: "Initialize the client",
      body: (
        <>
          Use the base URL shown on the{" "}
          <Link href="/developers" className="text-foreground underline">
            Developers
          </Link>{" "}
          page and the key from step 1. Never ship the raw key to a browser — see the security note at the bottom.
        </>
      ),
      code: {
        language: "ts",
        code: `import { Aegis } from "@aegis/agent-sdk";\n\nconst aegis = new Aegis({\n  apiKey: process.env.AEGIS_API_KEY!,\n  baseUrl: "${baseUrl}",\n});`,
      },
    },
    {
      title: "Register your agent (optional, but easiest for a first run)",
      body: "Skip this if the agent already exists in the dashboard — this just avoids a chicken-and-egg problem for a brand-new one.",
      code: {
        language: "ts",
        code: `await aegis.registerAgent({\n  name: "Finance Agent",\n  modelProvider: "OpenAI",\n  modelName: "gpt-5",\n});`,
      },
    },
    {
      title: "Send your first event",
      body: (
        <>
          This shows up in{" "}
          <Link href="/activity" className="text-foreground underline">
            Activity
          </Link>{" "}
          immediately.
        </>
      ),
      code: {
        language: "ts",
        code: `await aegis.track({\n  agent: "finance-agent",\n  eventType: "TOOL_CALL",\n  action: "invoice.read",\n  resource: "invoice",\n  status: "SUCCESS",\n  metadata: { invoiceId: "inv_123" },\n});`,
      },
    },
    {
      title: "Ask for authorization",
      body: (
        <>
          This is the call that actually matters — it runs the same policy engine as the{" "}
          <Link href="/policies/test" className="text-foreground underline">
            policy tester
          </Link>
          . Try an action + context combination you know a policy escalates (the seeded demo org escalates any{" "}
          <code>refund.issue</code> over $500).
        </>
      ),
      code: {
        language: "ts",
        code: `const auth = await aegis.authorize({\n  agent: "finance-agent",\n  action: "refund.issue",\n  resource: "payment",\n  environment: "production",\n  context: { amount: 1250 },\n});\n\nconsole.log(auth.decision); // "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL"`,
      },
    },
    {
      title: "Handle a REQUIRE_APPROVAL decision",
      body: (
        <>
          If it escalated, the request now shows up at{" "}
          <Link href="/approvals" className="text-foreground underline">
            Approvals
          </Link>
          . Approve or reject it there as a human reviewer, then watch the SDK observe the resolved state below.
        </>
      ),
      code: {
        language: "ts",
        code: `if (auth.decision === "REQUIRE_APPROVAL") {\n  const approval = await aegis.waitForApproval({\n    approvalRequestId: auth.approvalRequestId,\n    timeoutMs: 120_000,\n  });\n\n  if (approval.status !== "APPROVED") {\n    throw new Error(\`Not approved: \${approval.status}\`);\n  }\n}\n\n// Only now does *your* code run the actual tool call — Aegis never does it for you.\nawait issueRefund();`,
      },
    },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Quickstart"
        description="From zero to a real, policy-gated agent action in about five minutes."
      />

      <div className="space-y-4">
        {steps.map((step, index) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle>
                {index + 1}. {step.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{step.body}</p>
              {step.code && <CodeBlock code={step.code.code} language={step.code.language} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4 border-danger-border bg-danger-bg">
        <CardContent className="py-4">
          <p className="text-sm font-medium text-foreground">Never expose your API key in a browser.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The SDK and the public API are meant for server-side agent runtimes only. A key shipped to client-side
            JavaScript is a key anyone viewing your page&rsquo;s source can steal and use to act as your
            organization.
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-center">
        <ButtonLink href="/developers/api-keys" variant="secondary" size="sm">
          Back to API keys
        </ButtonLink>
      </div>
    </div>
  );
}
