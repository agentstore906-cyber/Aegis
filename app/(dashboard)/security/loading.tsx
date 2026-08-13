import { Skeleton } from "@/components/ui/skeleton";

export default function SecurityLoading() {
  return (
    <div>
      <Skeleton className="mb-1 h-7 w-24" />
      <Skeleton className="mb-6 h-4 w-56" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>

      <Skeleton className="mt-4 mb-4 h-9 w-full max-w-2xl" />

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
