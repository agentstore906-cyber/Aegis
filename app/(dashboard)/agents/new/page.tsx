import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { CreateAgentForm } from "@/components/agents/create-agent-form";

export const metadata: Metadata = { title: "Create agent" };

export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Create agent"
        description="Register a new agent so Aegis can start tracking its activity."
      />
      <div className="rounded-lg border border-border bg-surface p-6">
        <CreateAgentForm />
      </div>
    </div>
  );
}
