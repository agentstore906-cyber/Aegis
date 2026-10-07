import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like Aegis Control: title bar, hero, figure rail, then agent cards. No content is implied. */
export default function AgentsLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl pb-12" role="status" aria-label="Loading Aegis Control">
      <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl sm:w-72" />
      </div>
      <Skeleton className="mt-5 h-72 w-full rounded-[28px]" />
      <Skeleton className="mt-6 h-20 w-full rounded-2xl" />
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
