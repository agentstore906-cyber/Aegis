"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useRef, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/field";
import { ACTIVITY_RISK_LEVELS, ACTIVITY_STATUSES, ACTIVITY_RANGES } from "@/lib/validation/activity";

const RANGE_LABELS: Record<(typeof ACTIVITY_RANGES)[number], string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export function ActivityFilters({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function updateParamDebounced(key: string, value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParam(key, value), 300);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search action or resource…"
          defaultValue={searchParams.get("q") ?? ""}
          onChange={(e) => updateParamDebounced("q", e.target.value)}
          className="pl-8"
          aria-label="Search activity"
        />
      </div>

      <Select
        defaultValue={searchParams.get("agentId") ?? ""}
        onChange={(e) => updateParam("agentId", e.target.value)}
        className="sm:w-44"
        aria-label="Filter by agent"
      >
        <option value="">All agents</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        className="sm:w-44"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {ACTIVITY_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.replaceAll("_", " ")}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("riskLevel") ?? ""}
        onChange={(e) => updateParam("riskLevel", e.target.value)}
        className="sm:w-36"
        aria-label="Filter by risk"
      >
        <option value="">All risk</option>
        {ACTIVITY_RISK_LEVELS.map((risk) => (
          <option key={risk} value={risk}>
            {risk.charAt(0) + risk.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("range") ?? "all"}
        onChange={(e) => updateParam("range", e.target.value)}
        className="sm:w-40"
        aria-label="Filter by time range"
      >
        {ACTIVITY_RANGES.map((range) => (
          <option key={range} value={range}>
            {RANGE_LABELS[range]}
          </option>
        ))}
      </Select>
    </div>
  );
}
