import { notFound } from "next/navigation";
import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/admin/authorization";
import { Logo } from "@/components/ui/logo";

const ADMIN_NAV = [
  { label: "Leads", href: "/admin/leads" },
  { label: "Feedback", href: "/admin/feedback" },
  { label: "Metrics", href: "/admin/metrics" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // 404, not a 403 — normal organization users should get no signal this
  // route exists at all. See lib/admin/authorization.ts.
  if (!isPlatformAdmin(user.email)) notFound();

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-5">
            <Logo />
            <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Internal
            </span>
            <nav className="flex items-center gap-4" aria-label="Admin">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="focus-ring rounded-sm text-sm text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
