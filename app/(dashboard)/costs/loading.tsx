import { Skeleton } from "@/components/ui/skeleton";

export default function CostsLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border px-5 py-3.5 last:border-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
