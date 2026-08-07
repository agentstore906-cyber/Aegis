import { requireActiveOrganization } from "@/lib/organizations/queries";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization } = await requireActiveOrganization();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          organizationName={organization.name}
          plan={organization.plan}
          userName={user.name ?? user.email}
          userEmail={user.email}
        />
        <main className="flex-1 bg-surface-muted px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
