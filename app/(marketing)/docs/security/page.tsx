import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Security Intelligence",
  description: "The deterministic detectors that turn agent activity into security alerts.",
};

export default function SecurityDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Security intelligence"
      description="Aegis does not claim AI threat detection. Every alert is produced by a deterministic or statistical rule over data Aegis already has — never a black-box model."
    >
      <h2>What triggers an alert</h2>
      <ul>
        <li><strong>New sensitive action</strong> — the first time an agent ever attempts a high- or critical-risk action.</li>
        <li><strong>Block spike</strong> — an unusual number of blocked actions from one agent in a short window.</li>
        <li><strong>Failure loop</strong> — the same action failing repeatedly in a short window.</li>
        <li><strong>New tool usage</strong> — the first time an agent uses a given category of action.</li>
        <li><strong>High-risk burst</strong> — several high/critical-risk actions from one agent in a short window.</li>
        <li><strong>Cost spike</strong> — a day&rsquo;s spend for an agent that&rsquo;s a large multiple of its recent trailing average.</li>
      </ul>

      <h2>What every alert tells you</h2>
      <p>Every alert is designed to answer four questions: what happened, why it&rsquo;s unusual, what evidence triggered it (with any secret-shaped fields redacted), and what to inspect next — with direct links to the related activity, agent, and policy evaluations.</p>

      <h2>Deduplication</h2>
      <p>
        A repeat trigger of the same alert type for the same agent within 24 hours updates the existing open alert
        rather than creating a new one for every occurrence — so reviewing an alert&rsquo;s history stays readable
        instead of one row per repeat.
      </p>

      <h2>Acting on an alert</h2>
      <p>
        From an alert&rsquo;s detail page you can acknowledge it, resolve it, jump straight into creating a policy
        that would prevent it from recurring, or pause the agent that triggered it — a real action that actually
        blocks that agent&rsquo;s future evaluations, not a cosmetic status change.
      </p>
    </DocPage>
  );
}
