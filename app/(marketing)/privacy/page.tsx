import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Aegis collects, uses, and protects data.",
};

export default function PrivacyPage() {
  return (
    <DocPage eyebrow="Legal" title="Privacy Policy">
      <Alert tone="info">
        <strong>Draft — pending legal review.</strong> This page describes what
        Aegis actually does with data today, in plain language. It is not yet
        reviewed by counsel and should not be treated as a final, binding
        legal document.
      </Alert>

      <h2>What we collect</h2>
      <p>When you create an Aegis account and organization, we store:</p>
      <ul>
        <li>Your name and email address, and a bcrypt hash of your password (never the password itself).</li>
        <li>Your organization&rsquo;s name and the agents, policies, activity events, and audit data you create within it.</li>
        <li>Data your own AI agents send to Aegis via the public API and SDK — action names, resources, and any context you choose to include.</li>
      </ul>
      <p>
        We do not collect payment card details ourselves — billing is handled entirely by Lemon Squeezy, and Aegis never
        sees or stores your card number.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To operate the product: authenticate you, evaluate policy decisions, and show you activity, approvals, security alerts, and cost data.</li>
        <li>To maintain an audit trail of actions taken in your organization, for your own accountability and security review.</li>
        <li>To communicate with you about your account, such as approval notifications or billing events.</li>
      </ul>
      <p>
        Caller-supplied metadata sent through the public API (event context, evaluation context) is scanned and
        redacted for anything that looks like a credential (keys, tokens, passwords, secrets) before it is stored —
        see our <a href="/trust">Trust &amp; Security</a> page.
      </p>

      <h2>Cookies</h2>
      <p>
        Aegis sets first-party session cookies only — to keep you signed in and to remember which organization you have
        active. We do not use third-party advertising or tracking cookies.
      </p>

      <h2>Data sharing</h2>
      <p>
        We do not sell your data. Data is shared only with the infrastructure providers necessary to run the product
        (your database host, and Lemon Squeezy for billing where configured), and never across organizations — every row in
        Aegis is scoped to the organization that created it.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        You can request deletion of your account or organization data by contacting us (see <a href="/contact">Contact</a>).
        Configurable retention windows exist in the product for activity data; note that automatic scheduled deletion
        is not yet implemented — see our <a href="/docs/billing">documentation</a> for current retention behavior.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or a request to access, correct, or delete your data can be sent through our{" "}
        <a href="/contact">Contact page</a>.
      </p>
    </DocPage>
  );
}
