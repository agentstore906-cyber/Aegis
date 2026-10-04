import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholders shaped like the final pages (header, then a list or a grid of panels). No content is implied. */
function Header() {
  return (
    <div className="mb-6 space-y-2" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <Header />
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelsPageSkeleton({ metrics = 0 }: { metrics?: number }) {
  return (
    <div className="space-y-4">
      <Header />
      {metrics > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: metrics }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface px-4 py-3.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-12" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="space-y-3 px-4 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
