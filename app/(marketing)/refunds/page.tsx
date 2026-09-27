import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How refund requests for Aegis subscriptions are handled.",
};

export default function RefundsPage() {
  return (
    <DocPage eyebrow="Legal" title="Refund Policy">
      <p>Aegis is a subscription-based software service.</p>
      <p>
        Refund requests are handled in accordance with applicable consumer protection laws and the policies
        applicable to transactions processed through Paddle.
      </p>

      <h2>Technical issues</h2>
      <p>
        If you experience a significant technical issue that prevents you from using the Aegis service as described,
        please contact our support team so that we can investigate and attempt to resolve the issue.
      </p>

      <h2>Requesting a refund</h2>
      <p>
        Refund requests may be submitted through the applicable Paddle customer support and refund process. Refund
        eligibility may depend on applicable law, the nature of the transaction, and the circumstances of the request.
      </p>
      <p>
        Where a refund is approved, the applicable subscription or paid service may be terminated or adjusted as
        appropriate.
      </p>

      <h2>Paddle as Merchant of Record</h2>
      <p>
        For transactions processed through Paddle, Paddle acts as the Merchant of Record and may process applicable
        refunds in accordance with its policies and applicable law.
      </p>

      <h2>Your statutory rights</h2>
      <p>
        Nothing in this policy limits any mandatory consumer rights that cannot legally be excluded or restricted.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:support@aegissecurity.ink">support@aegissecurity.ink</a>
      </p>
    </DocPage>
  );
}
