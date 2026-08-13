import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listApiKeys } from "@/lib/api-keys/repository";
import { canManageApiKeys } from "@/lib/api-keys/authorization";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";
import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const { organization, role } = await requireActiveOrganization();
  const canManage = canManageApiKeys(role);

  const apiKeys = await listApiKeys(organization.id);

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
