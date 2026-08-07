"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";
import { POLICY_DECISIONS } from "@/lib/validation/policy";

export function EvaluationFilters({ agents }: { agents: { id: string; name: string }[] }) {
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
