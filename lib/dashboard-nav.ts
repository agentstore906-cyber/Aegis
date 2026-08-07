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
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  status: "active" | "soon";
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard, status: "active" },
  { label: "Agents", href: "/agents", icon: Bot, status: "active" },
  { label: "Activity", href: "/activity", icon: Activity, status: "active" },
  { label: "Approvals", href: "/approvals", icon: CheckCircle2, status: "soon" },
  { label: "Policies", href: "/policies", icon: ShieldCheck, status: "active" },
  { label: "Security", href: "/security", icon: ShieldAlert, status: "soon" },
  { label: "Costs", href: "/costs", icon: DollarSign, status: "soon" },
  { label: "Audit", href: "/audit", icon: ClipboardList, status: "soon" },
  { label: "Developers", href: "/developers", icon: Terminal, status: "soon" },
  { label: "Settings", href: "/settings", icon: Settings, status: "soon" },
];
