"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, LayoutDashboard, Menu, ShieldAlert, Users, X } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useDemo, type DemoView } from "./demo-context";

const NAV_ITEMS: { view: DemoView; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "agents", label: "Agents", icon: Users },
  { view: "activity", label: "Activity", icon: Activity },
  { view: "alerts", label: "Alerts", icon: ShieldAlert },
];

export function DemoShell({ children }: { children: React.ReactNode }) {
  const { view, navigate, alerts } = useDemo();
  const [mobileOpen, setMobileOpen] = useState(false);
  const openAlertCount = alerts.filter((alert) => alert.status === "open").length;

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <aside className="fixed inset-y-0 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        <DemoSidebarContent
          activeView={view}
          openAlertCount={openAlertCount}
          onNavigate={(next) => navigate(next)}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="focus-ring absolute inset-0 bg-foreground/20"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface">
            <DemoSidebarContent
              activeView={view}
              openAlertCount={openAlertCount}
              onNavigate={(next) => {
                navigate(next);
                setMobileOpen(false);
              }}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="focus-ring flex size-9 items-center justify-center rounded-md border border-border lg:hidden"
            >
              <Menu className="size-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-medium text-foreground">Acme Robotics</span>
            <Badge tone="info">Demo</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="focus-ring hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back to aegis.dev
            </Link>
            <div className="flex size-8 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
              JD
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function DemoSidebarContent({
  activeView,
  openAlertCount,
  onNavigate,
  onClose,
}: {
  activeView: DemoView;
  openAlertCount: number;
  onNavigate: (view: DemoView) => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-5">
        <div className="flex items-center gap-2">
          <LogoMark className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">Aegis</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="focus-ring flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Demo dashboard">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.view || (activeView === "agent-detail" && item.view === "agents");
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={cn(
                "focus-ring flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-surface-muted text-foreground"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="flex items-center gap-2.5">
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </span>
              {item.view === "alerts" && openAlertCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-semibold text-white">
                  {openAlertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-border px-5 py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sample data — nothing here is connected to a real production account.
        </p>
      </div>
    </>
  );
}
