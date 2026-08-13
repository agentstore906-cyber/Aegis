import type { Metadata } from "next";
import { DocPage } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Deployment",
  description: "What's required to run Aegis in production, and what's deployment-dependent.",
};

export default function DeploymentDocPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Deployment"
      description="Aegis doesn't assume a specific hosting provider — it's a standard web app with a Postgres database."
    >
      <h2>What you need</h2>
      <ul>
        <li>A PostgreSQL database (any managed provider works).</li>
        <li>A deployment platform that runs a Node.js server.</li>
        <li>A small set of required environment variables, validated at startup — a missing one fails fast with a clear message rather than a confusing downstream error.</li>
      </ul>

      <h2>Health checks</h2>
      <p>
        A dedicated health endpoint checks database connectivity and returns a simple ok/unavailable status, without
        ever revealing hostnames, connection strings, or version numbers. Point your platform&rsquo;s health check at
        it.
      </p>

      <h2>What&rsquo;s honestly not automated yet</h2>
      <p>There is no background job scheduler in this codebase today. Concretely, that means:</p>
      <ul>
        <li>Configured data retention windows are not automatically enforced by a scheduled deletion job.</li>
        <li>Outbound webhook delivery is immediate and best-effort with a couple of bounded retries, not a durable queue — a delivery lost during a restart is logged as a gap, not silently dropped, but it isn&rsquo;t retried later.</li>
      </ul>
      <p>
        If your deployment needs either of those to run on a real schedule, that requires adding scheduler
        infrastructure on top — we don&rsquo;t pretend one exists.
      </p>

      <h2>Backups</h2>
      <p>
        Database backup strategy is entirely deployment-dependent. Use your Postgres provider&rsquo;s backup or
        point-in-time-recovery feature — don&rsquo;t assume backups exist just because a managed database is in use.
      </p>
    </DocPage>
  );
}
