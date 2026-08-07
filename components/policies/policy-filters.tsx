"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useRef, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/field";
import { POLICY_DECISIONS, POLICY_STATUSES } from "@/lib/validation/policy";

export function PolicyFilters() {
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search policies…"
          defaultValue={searchParams.get("q") ?? ""}
          onChange={(e) => updateParamDebounced("q", e.target.value)}
          className="pl-8"
          aria-label="Search policies"
        />
      </div>

      <Select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        className="sm:w-40"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {POLICY_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("decision") ?? ""}
        onChange={(e) => updateParam("decision", e.target.value)}
        className="sm:w-44"
        aria-label="Filter by decision"
      >
        <option value="">All decisions</option>
        {POLICY_DECISIONS.map((decision) => (
          <option key={decision} value={decision}>
            {decision.replaceAll("_", " ")}
          </option>
        ))}
      </Select>
    </div>
  );
}
