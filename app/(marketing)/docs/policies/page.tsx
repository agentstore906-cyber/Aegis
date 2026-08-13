import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Policies & Permissions",
  description: "How Aegis decides ALLOW, REQUIRE_APPROVAL, or BLOCK for every agent action.",
};

export default function PoliciesDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Policies & permissions"
      description="Two layers feed every decision Aegis makes about an agent action."
    >
      <h2>Baseline permissions</h2>
      <p>
        The first layer answers &ldquo;what is this agent generally allowed to do?&rdquo; A permission matches an
        exact or wildcard <code>action</code> (and optionally a <code>resource</code>) for one agent, and resolves to
        <code>ALLOW</code>, <code>REQUIRE_APPROVAL</code>, or <code>BLOCK</code>.
      </p>

      <h2>Conditional policies</h2>
      <p>
        The second layer is conditional rules layered on top — &ldquo;under these conditions, what should Aegis do?&rdquo;
        A policy applies org-wide or to a specific agent, matches a scope, and evaluates a set of conditions that must
        all be true (AND, not OR) against the action&rsquo;s context. For example: &ldquo;if <code>action</code> is{" "}
        <code>refund.issue</code> and <code>amount</code> is greater than 500, require approval.&rdquo;
      </p>

      <h2>How a decision is resolved</h2>
      <p>When an agent asks Aegis about an action, both layers are checked and combined by strict precedence:</p>
      <p>
        <strong>BLOCK</strong> beats <strong>REQUIRE_APPROVAL</strong> beats <strong>ALLOW</strong> — regardless of
        priority ordering between policies. If anything blocks the action, it&rsquo;s blocked, full stop.
      </p>
      <p>
        An action with <strong>no matching permission and no matching policy resolves to BLOCK</strong>. The engine
        fails closed by default — it never silently allows something nobody explicitly permitted.
      </p>

      <h2>Every decision is recorded</h2>
      <p>
        Every evaluation is persisted with a deterministic, human-readable reason and the full context that produced
        it, so decisions are auditable and explainable after the fact — not just in the moment. You can test any
        action against your real policies from the in-app Policy Tester before wiring anything up.
      </p>
    </DocPage>
  );
}
