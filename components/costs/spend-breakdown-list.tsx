import { formatCurrency } from "@/lib/utils";
import type { LabeledSpend } from "@/lib/costs/queries";

export function SpendBreakdownList({ items }: { items: LabeledSpend[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No spend recorded this month.</p>;
  }

  const maxCents = Math.max(...items.map((i) => i.spendCents), 1);

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="min-w-0 truncate font-medium text-foreground">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(item.spendCents)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.max(4, (item.spendCents / maxCents) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
