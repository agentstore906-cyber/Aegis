import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Approvals & Audit",
  description: "How REQUIRE_APPROVAL decisions become real, resolvable human approvals.",
};

export default function ApprovalsDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Approvals & audit"
      description="Keeping a human in the loop for sensitive actions, with a permanent record of what happened."
    >
      <h2>The flow</h2>
      <p>
        When a policy evaluation resolves to <code>REQUIRE_APPROVAL</code>, Aegis creates an approval request in the
        same transaction as the evaluation — there is no window where a decision exists without a corresponding
        request. An authorized team member (Owner, Admin, or Security role) reviews it, with full context: the
        action, the amount or resource involved, which policy triggered the requirement, and the agent&rsquo;s
        recent history.
      </p>
      <p>
        Approving or rejecting records an immutable decision, with an optional comment. Resolution is race-safe — if
        two people act on the same request at once, exactly one resolution succeeds and the other is told the
        request was already resolved, rather than silently double-processing it.
      </p>

      <h2>Polling for a decision</h2>
      <p>
        An external agent process (via the SDK&rsquo;s <code>waitForApproval()</code> or by polling{" "}
        <code>GET /api/v1/approvals/:id</code> directly) can wait for a pending request to resolve, with capped
        backoff and a timeout, so it never blocks forever waiting on a human.
      </p>

      <h2>The audit trail</h2>
      <p>
        Every policy and permission change, every agent mutation, and every step of the approval lifecycle (request
        created, approved, rejected, expired) is written to an append-only audit log in the same transaction as the
        action it describes. There is no update or delete path for audit data — if something needs correcting, that&rsquo;s
        a new entry, not a rewritten one.
      </p>

      <h2>Trace correlation</h2>
      <p>
        Every request carries a <code>traceId</code> that threads through the activity event, the policy evaluation,
        the approval request, and the resulting audit events — so you can follow one agent action end-to-end from a
        single id.
      </p>
    </DocPage>
  );
}
