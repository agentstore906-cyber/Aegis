import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Bot,
  Activity,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  DollarSign,
  ClipboardList,
  Terminal,
  Settings,
  Webhook,
  MessageSquarePlus,
  Swords,
  CreditCard,
} from "lucide-react";

import type { Capability } from "@/lib/rbac/capabilities";

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
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard, status: "active" },
  { label: "Agents", href: "/agents", icon: Bot, status: "active" },
  { label: "Agent Arena", href: "/arena", icon: Swords, status: "active" },
  { label: "Activity", href: "/activity", icon: Activity, status: "active" },
  { label: "Approvals", href: "/approvals", icon: CheckCircle2, status: "active" },
  { label: "Policies", href: "/policies", icon: ShieldCheck, status: "active" },
  { label: "Security", href: "/security", icon: ShieldAlert, status: "active" },
  { label: "Costs", href: "/costs", icon: DollarSign, status: "active" },
  { label: "Audit", href: "/audit", icon: ClipboardList, status: "active" },
  { label: "Integrations", href: "/integrations", icon: Webhook, status: "active" },
  { label: "Developers", href: "/developers", icon: Terminal, status: "active" },
  { label: "Feedback", href: "/feedback", icon: MessageSquarePlus, status: "active" },
  { label: "Billing", href: "/settings/billing", icon: CreditCard, status: "active", capability: "view_billing" },
  { label: "Settings", href: "/settings/organization", icon: Settings, status: "active" },
];
