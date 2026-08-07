import { Skeleton } from "@/components/ui/skeleton";

export default function AgentDetailLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="mb-6 h-6 w-72" />
      <Skeleton className="mb-6 h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
