/** Shared with app/(dashboard)/settings/billing/page.tsx and the proactive limit nudges on create flows — one place for the "X of Y used" visual. */
export function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used} {limit === null ? "" : `/ ${limit}`}
        </span>
      </div>
      {limit !== null && (
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted">
          <div
            className={`h-1.5 rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-foreground"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
