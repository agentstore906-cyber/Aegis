import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="mb-4 h-9 w-full max-w-2xl" />
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
