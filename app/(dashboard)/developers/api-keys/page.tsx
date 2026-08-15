import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listApiKeys } from "@/lib/api-keys/repository";
import { canManageApiKeys } from "@/lib/api-keys/authorization";
import { getPlan } from "@/lib/billing/plans";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";
import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { EmptyState } from "@/components/ui/empty-state";
import { UsageBar } from "@/components/billing/usage-bar";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const { organization, role } = await requireActiveOrganization();
  const canManage = canManageApiKeys(role);

  const apiKeys = await listApiKeys(organization.id);
  const activeKeyCount = apiKeys.filter((key) => !key.revokedAt).length;
  const plan = getPlan(organization.plan);
  const atLimit = plan.apiKeyLimit !== null && activeKeyCount >= plan.apiKeyLimit;

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Organization-scoped credentials real agents use to call the Aegis API."
        action={
          <ButtonLink href="/developers/quickstart" variant="secondary" size="sm">
            Quickstart
          </ButtonLink>
        }
      />

      {canManage && plan.apiKeyLimit !== null && (
        <div className="mb-4">
          {atLimit ? (
            <Alert tone="warning">
              You&rsquo;ve used all {plan.apiKeyLimit} active API keys on the {plan.name} plan.{" "}
              <a href="/settings/billing" className="underline">
                Upgrade
              </a>{" "}
              for more.
            </Alert>
          ) : (
            <UsageBar label="Active API keys" used={activeKeyCount} limit={plan.apiKeyLimit} />
          )}
        </div>
      )}

      {canManage && (
        <div className="mb-6">
          <CreateApiKeyForm />
        </div>
      )}

      {apiKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description={
            canManage
              ? "Create one above to let a real agent authenticate with Aegis."
              : "Ask an Owner or Admin on your team to create one."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <ApiKeysTable apiKeys={apiKeys} canManage={canManage} />
        </div>
      )}
    </div>
  );
}
