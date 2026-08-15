import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageMembers } from "@/lib/organizations/authorization";
import { canViewBilling } from "@/lib/billing/authorization";
import { getPlan } from "@/lib/billing/plans";
import { listMembers } from "@/lib/organizations/members";
import { listPendingInvitations } from "@/lib/organizations/invitations";
import { listTeams } from "@/lib/teams/repository";
import { getCurrentOrigin } from "@/lib/request-origin";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { GeneralSettingsForm } from "@/components/settings/general-settings-form";
import { RetentionSettingsForm } from "@/components/settings/retention-settings-form";
import { MembersTable } from "@/components/settings/members-table";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { PendingInvitationsList } from "@/components/settings/pending-invitations-list";
import { TeamsPanel } from "@/components/settings/teams-panel";
import { UsageBar } from "@/components/billing/usage-bar";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage() {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageMembers(role)) notFound();

  const [members, invitations, teams, origin] = await Promise.all([
    listMembers(organization.id),
    listPendingInvitations(organization.id),
    listTeams(organization.id),
    getCurrentOrigin(),
  ]);
  const plan = getPlan(organization.plan);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Organization settings" description={organization.name} />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <GeneralSettingsForm name={organization.name} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan.memberLimit !== null && <UsageBar label="Members" used={members.length} limit={plan.memberLimit} />}
          <InviteMemberForm origin={origin} />
          <PendingInvitationsList invitations={invitations} origin={origin} />
          <div className="overflow-hidden rounded-lg border border-border">
            <MembersTable members={members} currentUserId={user.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamsPanel teams={teams} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
        </CardHeader>
        <CardContent>
          <RetentionSettingsForm
            activityRetentionDays={organization.activityRetentionDays}
            auditRetentionDays={organization.auditRetentionDays}
            securityRetentionDays={organization.securityRetentionDays}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border p-4">
            <p className="text-sm font-medium text-foreground">Single sign-on (SSO)</p>
            <p className="mt-1 text-sm text-muted-foreground">
              SAML / OIDC support is not available yet — this organization authenticates with email + password only.
              The schema is ready (<code>Organization.ssoEnabled</code>, <code>ssoProvider</code>) for when it ships.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Manage API keys for the public API and SDK.</p>
          <ButtonLink href="/developers/api-keys" variant="secondary" size="sm">
            API keys
          </ButtonLink>
        </CardContent>
      </Card>

      {canViewBilling(role) && (
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">View plan, usage, and manage your subscription.</p>
            <ButtonLink href="/settings/billing" variant="secondary" size="sm">
              Billing
            </ButtonLink>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
