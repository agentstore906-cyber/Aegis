import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewCosts } from "@/lib/costs/authorization";
import { getSpendByAgent, type AgentSpend } from "@/lib/costs/queries";
import { createCsvResponse } from "@/lib/csv/export";
import { formatCurrency } from "@/lib/utils";

/**
 * GET /costs/export — this month's per-agent spend. Unlike audit/security
 * (potentially large event logs), the number of agents in an organization
 * is small and bounded, so this fetches everything in one page rather
 * than cursor-paginating — still served through the same streaming
 * response shape as the other exports.
 */
export async function GET() {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewCosts(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await getSpendByAgent(organization.id);

  return createCsvResponse<AgentSpend>({
    filename: `costs-by-agent-${organization.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers: ["Agent", "Team", "Spend This Month", "Spend Previous Month", "Change %", "Requests", "Avg Cost / Request"],
    getCursor: (row) => row.agentId,
    toRow: (row) => [
      row.agentName,
      row.teamName ?? "",
      formatCurrency(row.spendCents),
      formatCurrency(row.previousPeriodSpendCents),
      row.changePercent === null ? "" : `${Math.round(row.changePercent)}%`,
      row.eventCount,
      formatCurrency(row.avgCostCents),
    ],
    fetchPage: async (cursor) => (cursor ? [] : rows),
  });
}
