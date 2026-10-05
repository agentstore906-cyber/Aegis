import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Bot,
  Activity,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Siren,
  Network,
  DollarSign,
  ClipboardList,
  Terminal,
  Settings,
  Webhook,
  MessageSquarePlus,
  CreditCard,
  Sparkles,
  ScanSearch,
} from "lucide-react";

import { hasCapability, type Capability } from "@/lib/rbac/capabilities";
import type { MemberRole } from "@prisma/client";

/** Which real number (if any) a nav item may show. Counts are queried, never invented — see lib/dashboard-nav-counts.ts. */
export type NavCountKey = "pendingApprovals" | "openIncidents" | "openAlerts";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  status: "active" | "soon";
  /**
   * When set, the item is only rendered for members whose role holds this
   * capability (see lib/rbac/capabilities.ts). The linked page still enforces
   * the same check server-side — this only keeps the nav honest so, e.g., an
   * Engineer isn't shown a Billing link that would 404 for them.
   */
  capability?: Capability;
  count?: NavCountKey;
  /** Spoken/tooltip description of what the count means. */
  countLabel?: string;
};

export type NavGroup = { id: string; label: string; items: NavItem[]; /** Collapsed behind a disclosure unless it holds the current page. */ collapsible?: boolean };

/**
 * Information architecture. A short primary list names the product's core areas; everything else that is real
 * lives under "More" (collapsed, but auto-opened when the current page is inside it) and in the command palette.
 * Settings and Feedback sit at the bottom (NAV_UTILITY).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "core",
    label: "",
    items: [
      { label: "Command center", href: "/overview", icon: LayoutDashboard, status: "active" },
      { label: "Agents", href: "/agents", icon: Bot, status: "active" },
      { label: "Risk", href: "/risk-control", icon: Gauge, status: "active", capability: "view_security" },
      { label: "Policies", href: "/policies", icon: ShieldCheck, status: "active" },
      { label: "Approvals", href: "/approvals", icon: CheckCircle2, status: "active", count: "pendingApprovals", countLabel: "pending approvals" },
      { label: "Incidents", href: "/incidents", icon: Siren, status: "active", capability: "view_security", count: "openIncidents", countLabel: "open incidents" },
      { label: "Audit", href: "/audit", icon: ClipboardList, status: "active" },
    ],
  },
  {
    id: "more",
    label: "More",
    collapsible: true,
    items: [
      { label: "Activity", href: "/activity", icon: Activity, status: "active" },
      { label: "Security alerts", href: "/security", icon: ShieldAlert, status: "active", capability: "view_security", count: "openAlerts", countLabel: "open high or critical alerts" },
      { label: "Control plane", href: "/control", icon: Network, status: "active", capability: "view_security" },
      { label: "Free AI Agent Risk Scanner", href: "/risk-scan", icon: ScanSearch, status: "active", capability: "view_security" },
      { label: "Costs", href: "/costs", icon: DollarSign, status: "active" },
      { label: "Ask Aegis", href: "/ask", icon: Sparkles, status: "active" },
      { label: "Developers", href: "/developers", icon: Terminal, status: "active" },
      { label: "Integrations", href: "/integrations", icon: Webhook, status: "active" },
      { label: "Billing", href: "/settings/billing", icon: CreditCard, status: "active", capability: "view_billing" },
    ],
  },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_UTILITY: NavItem[] = [
  { label: "Settings", href: "/settings/organization", icon: Settings, status: "active" },
  { label: "Feedback", href: "/feedback", icon: MessageSquarePlus, status: "active" },
];

/** Flat list (groups then utility), kept for callers that want every destination. */
export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_UTILITY];

export const isVisibleTo = (item: NavItem, role: MemberRole) => !item.capability || hasCapability(role, item.capability);

/** Groups and utility links the role may see; a group with no visible items disappears. */
export function navFor(role: MemberRole): { groups: NavGroup[]; utility: NavItem[] } {
  return {
    groups: NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => isVisibleTo(i, role)) })).filter((g) => g.items.length > 0),
    utility: NAV_UTILITY.filter((i) => isVisibleTo(i, role)),
  };
}

/**
 * The most specific nav item that matches a path is the active one, so "/settings/billing"
 * does not also light up "Settings" (/settings/organization) and "/policies" never matches "/policies-x".
 */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (best === null || item.href.length > best.length)) best = item.href;
  }
  // Settings has several sibling pages under /settings/*.
  if (best === null && pathname.startsWith("/settings/")) return "/settings/organization";
  return best;
}
