import { cn } from "@/lib/utils";
import {
  ARENA_CATEGORIES,
  ARENA_CATEGORY_LABELS,
  type ArenaCategory,
  type CategoryScores,
} from "@/lib/arena/types";

function toneFor(score: number): string {
  if (score >= 80) return "bg-success";
  if (score >= 55) return "bg-warning";
  return "bg-danger";
}

export function CategoryBars({
  scores,
  lowConfidence = [],
}: {
  scores: CategoryScores;
  lowConfidence?: ArenaCategory[];
}) {
  return (
    <ul className="space-y-3">
      {ARENA_CATEGORIES.map((category) => {
        const score = scores[category];
        const isLowConfidence = lowConfidence.includes(category);
        return (
          <li key={category}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-foreground">
                {ARENA_CATEGORY_LABELS[category]}
                {isLowConfidence && (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    limited data
                  </span>
                )}
              </span>
              <span className="font-medium tabular-nums text-foreground">{score}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn("h-full rounded-full", toneFor(score))}
                style={{ width: `${score}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
