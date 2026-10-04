import { adminRoute } from "@/lib/api/admin-route";
import { intParam } from "@/lib/api/behavior-route";
import { ApiError } from "@/lib/api/errors";
import { getInventory, type InventoryFilters } from "@/lib/control/inventory";
import { ATTENTION_FLAG_LABEL, type AgentPosture, type AttentionFlag } from "@/lib/control/posture";

const ENVIRONMENTS = ["PRODUCTION", "STAGING", "DEVELOPMENT"] as const;
const STATUSES = ["ACTIVE", "PAUSED", "STOPPED", "NEEDS_ATTENTION", "ARCHIVED"] as const;
const POSTURES: readonly AgentPosture[] = ["PROTECTED", "OBSERVED", "QUIET", "DISCOVERED", "NEEDS_ATTENTION", "PAUSED", "STOPPED", "RETIRED"];
const FLAGS = Object.keys(ATTENTION_FLAG_LABEL) as AttentionFlag[];

function choice<T extends string>(url: URL, name: string, options: readonly T[]): T | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === "") return undefined;
  if (!(options as readonly string[]).includes(value)) {
    throw new ApiError("INVALID_REQUEST", `\`${name}\` must be one of: ${options.join(", ")}.`, 400);
  }
  return value as T;
}

/**
 * GET /api/v1/agents — the organization-wide agent inventory: for every
 * agent, its identity, owner, lifecycle, derived posture and adoption stage,
 * access summary, trust, behavior, approvals, incidents, identity protection
 * and enforcement coverage — plus an organization summary. For governance and
 * CMDB/SIEM reporting.
 *
 * Opt-in scope `agents:read`; organization-wide keys only (it exposes every
 * agent's state). Paginated (`page`, `pageSize` ≤ 100) and filterable
 * (`environment`, `status`, `posture`, `flag`, `q`). Every number is a count of
 * stored rows over the last 7 days. See docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §6.
 */
export const GET = adminRoute("agents.inventory", "agents:read", async (request, ctx) => {
  const url = new URL(request.url);
  const filters: InventoryFilters = {
    environment: choice(url, "environment", ENVIRONMENTS),
    status: choice(url, "status", STATUSES),
    posture: choice(url, "posture", POSTURES),
    flag: choice(url, "flag", FLAGS),
    q: url.searchParams.get("q")?.slice(0, 80) || undefined,
    page: intParam(url, "page", 1, 1, 100_000),
    pageSize: intParam(url, "pageSize", 50, 1, 100),
  };
  const inventory = await getInventory(ctx.organization.id, filters);
  return Response.json({
    summary: inventory.summary,
    agents: inventory.agents,
    page: { page: inventory.page, pageSize: inventory.pageSize, pageCount: inventory.pageCount, total: inventory.total },
    truncated: inventory.truncated,
  });
});
