import { Skeleton } from "@/components/ui/skeleton";

export default function OverviewLoading() {
  return (
    <div>
      <Skeleton className="mb-1 h-7 w-32" />
      <Skeleton className="mb-6 h-4 w-64" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-5 py-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
