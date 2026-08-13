import type { Metadata } from "next";
import { KeyRound, Rocket, BookOpen } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getCurrentOrigin } from "@/lib/request-origin";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  await requireActiveOrganization();
  const baseUrl = await getCurrentOrigin();

  return (
    <div>
      <PageHeader
        title="Developers"
        description="Everything a real agent needs to authenticate with Aegis and ask for a decision before acting."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>API base URL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground">
              {baseUrl}
            </code>
            <CopyButton value={baseUrl} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Pass this as <code>baseUrl</code> to <code>@aegis/agent-sdk</code>, or prefix it onto{" "}
            <code>/api/v1/...</code> if you&rsquo;re calling the API directly.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">API keys</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create, view, and revoke organization-scoped credentials.
              </p>
            </div>
            <ButtonLink href="/developers/api-keys" variant="secondary" size="sm">
              Manage API keys
            </ButtonLink>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
              <Rocket className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Quickstart</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Install the SDK, send your first event, and see a policy decision.
              </p>
            </div>
            <ButtonLink href="/developers/quickstart" variant="secondary" size="sm">
              Open quickstart
            </ButtonLink>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="flex items-center gap-3 py-4">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Full endpoint reference lives in <code>docs/api.md</code> in the repository.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
