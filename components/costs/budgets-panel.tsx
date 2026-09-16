"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteBudgetAction } from "@/lib/costs/actions";
import { formatCurrency } from "@/lib/utils";
import type { BudgetStatus } from "@/lib/costs/budgets";

/**
 * Every "exceeded" row is deliberately worded as an alert, never an
 * enforcement claim (spec §6) — Aegis has no mechanism to stop an agent's
 * own spending with its model provider, only to notice and say so.
 */
export function BudgetsPanel({ statuses, canManage }: { statuses: BudgetStatus[]; canManage: boolean }) {
  if (statuses.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">No budgets configured yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {statuses.map(({ budget, spentCents, percent, exceeded, warning }) => (
        <li key={budget.id} className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {budget.agent ? (
                  <Link href={`/agents/${budget.agent.slug}`} className="hover:underline">
                    {budget.agent.name}
                  </Link>
                ) : (
                  "Organization-wide"
                )}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {budget.period === "DAILY" ? "Daily" : "Monthly"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatCurrency(spentCents)} of {formatCurrency(budget.limitCents)} ({Math.round(percent)}%)
              </p>
            </div>
            {canManage && (
              <ConfirmDialog
                title="Delete budget"
                description={`Delete the ${budget.period === "DAILY" ? "daily" : "monthly"} budget for ${
                  budget.agent ? budget.agent.name : "the whole organization"
                }? This stops future budget alerts for this scope.`}
                confirmLabel="Delete"
                onConfirm={() => deleteBudgetAction(budget.id)}
                trigger={
                  <Button variant="ghost" size="sm" type="button" aria-label="Delete budget">
                    <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
                  </Button>
                }
              />
            )}
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className={`h-full rounded-full ${exceeded ? "bg-danger" : warning ? "bg-warning" : "bg-success"}`}
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>

          {exceeded && (
            <p className="mt-1.5 text-xs text-danger">
              Budget exceeded — alert triggered. Aegis cannot block this agent&rsquo;s spending; review recent
              activity or raise the limit.
            </p>
          )}
          {!exceeded && warning && <p className="mt-1.5 text-xs text-warning">Approaching budget limit.</p>}
        </li>
      ))}
    </ul>
  );
}
