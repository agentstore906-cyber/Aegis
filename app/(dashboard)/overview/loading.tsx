import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 pb-16" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="mt-4 h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
