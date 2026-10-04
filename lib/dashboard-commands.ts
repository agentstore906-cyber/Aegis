import type { MemberRole } from "@prisma/client";

import { navFor } from "@/lib/dashboard-nav";
import { hasCapability, type Capability } from "@/lib/rbac/capabilities";

export type PaletteCommand = { id: string; label: string; href: string; group: string; keywords?: string };

/** Actions that open a real page. Each is only offered to roles that hold the capability the page itself requires. */
const ACTIONS: { id: string; label: string; href: string; capability?: Capability; keywords: string }[] = [
  { id: "new-agent", label: "Register an agent", href: "/agents/new", capability: "manage_agents", keywords: "create add connect new" },
  { id: "new-policy", label: "Create a policy", href: "/policies/new", capability: "manage_policies", keywords: "rule add new" },
  { id: "test-policy", label: "Test a policy", href: "/policies/test", keywords: "simulate evaluate dry run" },
  { id: "api-keys", label: "Manage API keys", href: "/developers/api-keys", capability: "manage_api_keys", keywords: "token credentials sdk" },
  { id: "quickstart", label: "Developer quickstart", href: "/developers/quickstart", keywords: "sdk install integrate docs" },
];

/** Everything the palette can jump to for a role: the same destinations as the navigation, plus a few real actions. */
export function paletteCommands(role: MemberRole): PaletteCommand[] {
  const { groups, utility } = navFor(role);
  const pages: PaletteCommand[] = [
    ...groups.flatMap((g) => g.items.map((i) => ({ id: i.href, label: i.label, href: i.href, group: "Go to" }))),
    ...utility.map((i) => ({ id: i.href, label: i.label, href: i.href, group: "Go to" })),
  ];
  const actions: PaletteCommand[] = ACTIONS.filter((a) => !a.capability || hasCapability(role, a.capability)).map((a) => ({
    id: a.id,
    label: a.label,
    href: a.href,
    group: "Actions",
    keywords: a.keywords,
  }));
  return [...pages, ...actions];
}
