import { cn } from "@/lib/utils";
import { grade } from "@/lib/arena/scoring";

/**
 * The headline "847 / 1000" figure. Pure and theme-safe — used on the
 * dashboard scorecard and the public page alike.
 */
export function ScoreDial({
  score,
  size = "lg",
  showGrade = true,
}: {
  score: number;
  size?: "md" | "lg";
  showGrade?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, score / 10));
  const tone =
    score >= 800 ? "text-success" : score >= 520 ? "text-warning" : "text-danger";
  const track =
    score >= 800 ? "bg-success" : score >= 520 ? "bg-warning" : "bg-danger";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-semibold tabular-nums tracking-tight",
            tone,
            size === "lg" ? "text-6xl" : "text-4xl"
          )}
        >
          {score}
        </span>
        <span className={cn("text-muted-foreground", size === "lg" ? "text-xl" : "text-base")}>
          / 1000
        </span>
      </div>
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-muted">
        <div className={cn("h-full rounded-full", track)} style={{ width: `${pct}%` }} />
      </div>
      {showGrade && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {grade(score)}
        </p>
      )}
    </div>
  );
}
