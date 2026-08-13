"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";
import { APPROVAL_STATUSES } from "@/lib/validation/approval";
import { AGENT_RISK_LEVELS } from "@/lib/validation/agent";

export function ApprovalFilters({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

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

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Select
        defaultValue={searchParams.get("status") ?? "PENDING"}
        onChange={(e) => updateParam("status", e.target.value)}
        className="sm:w-44"
        aria-label="Filter by status"
      >
        {APPROVAL_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
        <option value="">All statuses</option>
      </Select>

      <Select
        defaultValue={searchParams.get("agentId") ?? ""}
        onChange={(e) => updateParam("agentId", e.target.value)}
        className="sm:w-48"
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
        defaultValue={searchParams.get("riskLevel") ?? ""}
        onChange={(e) => updateParam("riskLevel", e.target.value)}
        className="sm:w-40"
        aria-label="Filter by risk"
      >
        <option value="">All risk levels</option>
        {AGENT_RISK_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level.charAt(0) + level.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>
    </div>
  );
}
