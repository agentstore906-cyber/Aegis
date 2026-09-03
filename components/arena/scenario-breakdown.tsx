import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";

import { ARENA_CATEGORY_LABELS, type ArenaCategory } from "@/lib/arena/types";

type Result = {
  id: string;
  category: string;
  scenarioKey: string;
  title: string;
  passed: boolean;
  score: number;
  detail: string;
};

/**
 * Owner-only breakdown of the probe suite. Safe to show here (behind the
 * org's auth) — the public scorecard never renders this.
 */
export function ScenarioBreakdown({ results }: { results: Result[] }) {
  const byCategory = new Map<string, Result[]>();
  for (const r of results) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  return (
    <div className="space-y-5">
      {[...byCategory.entries()].map(([category, list]) => (
        <div key={category}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ARENA_CATEGORY_LABELS[category as ArenaCategory] ?? category}
          </h4>
          <ul className="divide-y divide-border rounded-md border border-border">
            {list.map((r) => {
              const Icon = r.passed ? CheckCircle2 : r.score > 0 ? MinusCircle : XCircle;
              const tone = r.passed
                ? "text-success"
                : r.score > 0
                  ? "text-warning"
                  : "text-danger";
              return (
                <li key={r.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {r.score}/100
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
