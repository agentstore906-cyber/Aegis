import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of Aegis.",
};

export default function TermsPage() {
  return (
    <DocPage eyebrow="Legal" title="Terms of Service">
      <Alert tone="info">
        <strong>Draft — pending legal review.</strong> This page is a
        structural placeholder describing the intended terms of use. It is
        not yet reviewed by counsel and should not be treated as a final,
        binding legal document.
      </Alert>

      <h2>Using Aegis</h2>
      <p>
        Aegis is a control plane for monitoring, governing, and auditing AI agents. By creating an account, you agree
        to use it only for its intended purpose and in compliance with applicable law.
      </p>

      <h2>Your account and organization</h2>
      <ul>
        <li>You are responsible for the accuracy of information you provide and for safeguarding your account credentials and API keys.</li>
        <li>You are responsible for the actions your AI agents take and for the accuracy of the data they report to Aegis.</li>
        <li>Organization owners and admins are responsible for who they invite and what role they grant.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Aegis to store or transmit unlawful content, or to circumvent another party&rsquo;s security.</li>
        <li>Attempt to access another organization&rsquo;s data, or to probe, scan, or test the vulnerability of the platform without authorization.</li>
        <li>Resell or sublicense access to Aegis without a separate agreement.</li>
      </ul>

      <h2>Plans and billing</h2>
      <p>
        Paid plans are billed through Stripe on the cadence shown at checkout. Plan limits and features are described
        on our <a href="/pricing">Pricing</a> page and enforced by the product itself, not just displayed. You can
        cancel or change your plan at any time from your billing settings.
      </p>

      <h2>Service availability</h2>
      <p>
        Aegis is provided on an as-is, as-available basis during this stage of the product. We do not currently
        publish a formal uptime SLA. Deployment-specific operational details are documented in{" "}
        <a href="/docs/deployment">our deployment documentation</a>.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using Aegis and delete your organization at any time. We may suspend or terminate access for
        violation of these terms or the acceptable use section above.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms as the product evolves. Material changes will be reflected on this page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms can be sent through our <a href="/contact">Contact page</a>.
      </p>
    </DocPage>
  );
}
