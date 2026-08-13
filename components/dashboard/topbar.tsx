import { MobileSidebar } from "@/components/dashboard/mobile-sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Badge } from "@/components/ui/badge";

export function Topbar({
  organizationName,
  plan,
  userName,
  userEmail,
}: {
  organizationName: string;
  plan: string;
  userName: string;
  userEmail: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileSidebar />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{organizationName}</span>
          <Badge tone="neutral" className="shrink-0 capitalize">
            {plan}
          </Badge>
        </div>
      </div>

      <UserMenu name={userName} email={userEmail} />
    </header>
  );
}
