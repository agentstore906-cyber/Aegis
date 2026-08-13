import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Webhook } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageWebhooks } from "@/lib/webhooks/authorization";
import { listWebhookEndpoints, listDeliveriesForEndpoint } from "@/lib/webhooks/repository";
import { formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateWebhookForm } from "@/components/webhooks/create-webhook-form";
import { WebhookEndpointActions } from "@/components/webhooks/webhook-endpoint-actions";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageWebhooks(role)) notFound();

  const endpoints = await listWebhookEndpoints(organization.id);
  const deliveriesByEndpoint = await Promise.all(
    endpoints.map((endpoint) => listDeliveriesForEndpoint(organization.id, endpoint.id, 5))
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Integrations"
        description="Outbound webhooks — Aegis POSTs a signed JSON payload when a subscribed event happens."
      />

      <div className="mb-6">
        <CreateWebhookForm />
      </div>

      {endpoints.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhook endpoints yet"
          description="Create one above to receive security alerts, approval decisions, and cost anomalies in real time."
        />
      ) : (
        <div className="space-y-4">
          {endpoints.map((endpoint, index) => {
            const deliveries = deliveriesByEndpoint[index];
            return (
              <Card key={endpoint.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{endpoint.url}</CardTitle>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={endpoint.status === "ACTIVE" ? "success" : "neutral"} dot={endpoint.status === "ACTIVE"}>
                        {endpoint.status === "ACTIVE" ? "Active" : "Disabled"}
                      </Badge>
                      {endpoint.subscribedEvents.map((event) => (
                        <Badge key={event} tone="neutral">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <WebhookEndpointActions id={endpoint.id} status={endpoint.status} />
                </CardHeader>
                <CardContent className="p-0">
                  {deliveries.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-muted-foreground">No deliveries yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {deliveries.map((delivery) => (
                        <li key={delivery.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs text-foreground">{delivery.eventType}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(delivery.createdAt)} · attempt {delivery.attempt}
                              {delivery.httpStatus ? ` · HTTP ${delivery.httpStatus}` : ""}
                            </p>
                          </div>
                          <Badge tone={delivery.status === "SUCCESS" ? "success" : "danger"}>
                            {delivery.status === "SUCCESS" ? "Delivered" : "Failed"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Delivery is best-effort with a couple of bounded retries — not a durable queue. See{" "}
        <code>docs/webhooks.md</code>.
      </p>
    </div>
  );
}
