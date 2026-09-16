import type { Metadata } from "next";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { AskAegisForm } from "@/components/ask/ask-aegis-form";

export const metadata: Metadata = { title: "Ask Aegis" };

export default async function AskAegisPage() {
  await requireActiveOrganization();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Ask Aegis"
        description="Ask questions about your agents, activity, costs, and security — answered from your actual Aegis data, with evidence."
      />
      <AskAegisForm />
    </div>
  );
}
