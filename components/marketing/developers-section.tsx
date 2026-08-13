import { CodeBlock } from "@/components/ui/code-block";
import { TrackedButtonLink } from "@/components/analytics/tracked-button-link";

const SNIPPET = `import { Aegis } from "@aegis/agent-sdk";

const aegis = new Aegis({
  apiKey: process.env.AEGIS_API_KEY!,
  baseUrl: process.env.AEGIS_BASE_URL!,
});

const auth = await aegis.authorize({
  agent: "finance-agent",
  action: "refund.issue",
  context: { amount: 1250 },
});

if (auth.decision === "REQUIRE_APPROVAL") {
  const approval = await aegis.waitForApproval({
    approvalRequestId: auth.approvalRequestId,
  });
}`;

const PROPERTIES = [
  "Versioned public API (/api/v1) — safe to build on",
  "Idempotency-Key support on every mutating endpoint",
  "Typed errors and bounded retry/backoff in the SDK",
  "Organization-scoped API keys, SHA-256 hashed, never stored raw",
];

export function DevelopersSection() {
  return (
    <section id="developers" className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Built for real agent code, not just a dashboard.
            </h2>
            <p className="mt-4 text-muted-foreground">
              A real external agent process can authenticate, report activity, and ask
              Aegis for a decision before acting — with a small, typed SDK that never
              executes anything on your behalf.
            </p>
            <ul className="mt-6 space-y-2.5">
              {PROPERTIES.map((property) => (
                <li key={property} className="flex items-start gap-2.5 text-sm text-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  {property}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <TrackedButtonLink
                href="/sign-up"
                size="lg"
                event="landing_cta_clicked"
                eventProps={{ source: "developers_section" }}
              >
                Start Free
              </TrackedButtonLink>
            </div>
          </div>

          <CodeBlock code={SNIPPET} language="typescript" />
        </div>
      </div>
    </section>
  );
}
