import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getNavCounts } from "@/lib/dashboard-nav-counts";
import { claimScansForSession } from "@/lib/scanner/service";
import { getSessionHash } from "@/lib/scanner/session";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization, role } = await requireActiveOrganization();
  // Real counts only; a count that cannot be read is simply not shown.
  const counts = await getNavCounts(organization.id, role);

  // Free scanner: attach scans made anonymously in this browser to the account that just signed in.
  // Idempotent, cheap (one indexed lookup) and never allowed to break the dashboard.
  try {
    const sessionHash = await getSessionHash();
    if (sessionHash) await claimScansForSession({ sessionHash, userId: user.id, organizationId: organization.id, userCreatedAt: user.createdAt });
  } catch {
    // The scan simply stays anonymous; the user can retry from the report.
  }

  return (
    <div className="aegis-console flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <Topbar organizationName={organization.name} role={role} userName={user.name ?? user.email} userEmail={user.email} counts={counts} />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col bg-background px-4 pb-10 pt-4 outline-none sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
