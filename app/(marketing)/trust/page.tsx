import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Trust & Security",
  description: "How Aegis protects your organization's data, agents, and audit history.",
};

export default function TrustPage() {
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <DocPage
      eyebrow="Trust"
      title="Trust & Security"
      description="Aegis is built with enterprise security principles — tenant isolation, least-privilege access, and an audit trail that can't be edited after the fact."
    >
      <p>
        We don&rsquo;t claim certifications we don&rsquo;t have. This page describes what Aegis actually does today, not
        aspirational marketing language. If something below matters to your evaluation and you want more detail,{" "}
        <a href="/contact">reach out</a>.
      </p>

      <h2>Tenant isolation</h2>
      <p>
        Every organization&rsquo;s data — agents, activity, policies, approvals, audit events, security alerts — is
        scoped by an <code>organizationId</code> that is always derived server-side from your authenticated session
        or API key, never trusted from client input. Every database query that reads or writes tenant data includes
        that scope directly, so one organization can never see or modify another&rsquo;s data through the application
        or the public API.
      </p>

      <h2>Role-based access control</h2>
      <p>
        Access within an organization is governed by six fixed roles — Owner, Admin, Engineer, Security, Finance, and
        Viewer — through a single, central capability map rather than scattered role checks across the codebase. An
        organization can never end up with zero Owners, and only an existing Owner can grant or remove the Owner
        role, closing the usual privilege-escalation path.
      </p>

      <h2>Audit trail</h2>
      <p>
        Every policy and permission change, every agent mutation, and every approval decision is recorded to an
        append-only audit log — there is no update or delete path exposed for audit data. Mutations and their audit
        record are written in the same database transaction, so an audited action can never succeed without leaving
        a trace.
      </p>

      <h2>Policy engine: fails closed</h2>
      <p>
        When an agent asks Aegis whether it&rsquo;s allowed to take an action, and nothing — no permission, no policy —
        matches that action, the decision is <strong>BLOCK</strong>, not <strong>ALLOW</strong>. The engine is
        designed to fail closed by default, and an unexpected error during evaluation raises rather than silently
        defaulting to allow.
      </p>

      <h2>API keys</h2>
      <p>
        API keys are organization-scoped credentials shown to you exactly once at creation. Aegis never stores or
        logs the raw key — only a SHA-256 hash of it, looked up on each request. Keys can be revoked immediately from
        the dashboard, and support optional expiration.
      </p>

      <h2>Secret redaction</h2>
      <p>
        Metadata and context your agents send us — event payloads, evaluation context, approval context — is scanned
        for credential-shaped fields (keys, tokens, passwords, secrets, cookies, authorization headers) and redacted
        before it is ever written to the database, across every ingestion path.
      </p>

      <h2>Outbound webhooks</h2>
      <p>
        Webhook deliveries are HMAC-signed with a per-endpoint secret so receivers can verify authenticity, and every
        destination URL is checked against private/internal IP ranges — both when you create the endpoint and again
        immediately before each delivery, since DNS answers can change between the two.
      </p>

      <h2>Application security</h2>
      <ul>
        <li>Passwords are hashed with bcrypt; hashes are never sent to the client.</li>
        <li>All mutations are validated server-side with a schema library, never relying on client-side validation alone.</li>
        <li>Standard security headers (Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, and HSTS in production) are set on every response.</li>
        <li>The public API is rate-limited per key and supports an idempotency key so a retried request can&rsquo;t duplicate a mutation.</li>
      </ul>

      <h2>What we don&rsquo;t claim</h2>
      <p>
        We are not SOC 2, ISO 27001, HIPAA, or GDPR certified. If your organization requires a formal certification or
        compliance attestation as a condition of adoption, <a href="/contact">talk to us</a> — we&rsquo;d rather tell
        you where we stand today than imply something we can&rsquo;t back up.
      </p>

      <h2>Responsible disclosure</h2>
      <p>
        If you believe you&rsquo;ve found a security issue in Aegis, we want to hear about it before anyone else
        does.{" "}
        {contactEmail ? (
          <>
            Email <a href={`mailto:${contactEmail}?subject=Security%20disclosure`}>{contactEmail}</a> with what you
            found and how to reproduce it. Please don&rsquo;t test against organizations or data that aren&rsquo;t
            your own, and give us a reasonable window to respond before any public disclosure.
          </>
        ) : (
          <>A security contact isn&rsquo;t configured for this deployment yet — see <code>NEXT_PUBLIC_CONTACT_EMAIL</code> in <code>docs/deployment.md</code>.</>
        )}{" "}
        We don&rsquo;t currently run a paid bug bounty program — say so plainly rather than imply one exists.
      </p>
    </DocPage>
  );
}
