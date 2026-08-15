import type { Metadata } from "next";
import { MessageSquarePlus } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listFeatureRequests } from "@/lib/feedback/repository";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitFeatureRequestForm } from "@/components/feedback/submit-feature-request-form";
import { FeatureRequestList } from "@/components/feedback/feature-request-list";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const { organization, user } = await requireActiveOrganization();
  const requests = await listFeatureRequests(organization.id, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Feedback"
        description="Tell us what would make Aegis more valuable for your team. Visible to your organization only."
      />

      <Card>
        <CardHeader>
          <CardTitle>Submit a request</CardTitle>
        </CardHeader>
        <CardContent>
          <SubmitFeatureRequestForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {requests.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                icon={MessageSquarePlus}
                title="No requests yet"
                description="Be the first to suggest what Aegis should build next."
              />
            </div>
          ) : (
            <FeatureRequestList requests={requests} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
