import { Skeleton } from "@/components/ui/skeleton";

export default function ScanLoading() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-14" aria-busy="true" aria-label="Loading">
      <Skeleton className="mx-auto mb-3 h-9 w-3/4" />
      <Skeleton className="mx-auto mb-10 h-5 w-1/2" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
