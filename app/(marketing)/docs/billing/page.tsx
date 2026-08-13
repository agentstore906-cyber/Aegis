import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Billing & Plans",
  description: "How Aegis plan limits are defined and enforced.",
};

export default function BillingDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Billing & plans"
      description="Plan limits come from a single configuration and are enforced by the product itself — never just displayed in the UI."
    >
      <h2>Plans</h2>
      <p>
        Free, Startup, Growth, Business, and Enterprise plans differ by agent count, team member count, activity
        history retention window, and which features (policies, advanced security, audit export, and so on) are
        available. See <a href="/pricing">Pricing</a> for current limits and prices.
      </p>

      <h2>Server-side enforcement</h2>
      <p>
        Every limit is checked at the point of creation — adding an agent, inviting a member, creating an API key,
        creating a webhook endpoint, exporting an audit log — using the same configuration the pricing page reads
        from. A plan&rsquo;s limits can never drift from what&rsquo;s actually enforced, because both draw from one
        source.
      </p>

      <h2>Usage visibility</h2>
      <p>
        Your organization&rsquo;s billing page shows real, live usage against your plan&rsquo;s limits — not
        estimated or cached numbers.
      </p>

      <h2>Upgrading</h2>
      <p>
        Self-serve plans upgrade through a hosted checkout; you can manage your subscription, payment method, and
        invoices from a hosted billing portal at any time. Aegis never stores your card details directly.
      </p>
    </DocPage>
  );
}
