"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";
import { SECURITY_ALERT_SEVERITIES, SECURITY_ALERT_STATUSES } from "@/lib/validation/security";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";

const ALERT_TYPES = Object.values(SECURITY_ALERT_TYPES);

export function SecurityFilters({ agents }: { agents: { id: string; name: string }[] }) {
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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <Select
        defaultValue={searchParams.get("status") ?? "OPEN"}
        onChange={(e) => updateParam("status", e.target.value)}
        className="sm:w-40"
        aria-label="Filter by status"
      >
        {SECURITY_ALERT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
        <option value="">All statuses</option>
      </Select>

      <Select
        defaultValue={searchParams.get("severity") ?? ""}
        onChange={(e) => updateParam("severity", e.target.value)}
        className="sm:w-40"
        aria-label="Filter by severity"
      >
        <option value="">All severities</option>
        {SECURITY_ALERT_SEVERITIES.map((severity) => (
          <option key={severity} value={severity}>
            {severity.charAt(0) + severity.slice(1).toLowerCase()}
          </option>
        ))}
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
        defaultValue={searchParams.get("type") ?? ""}
        onChange={(e) => updateParam("type", e.target.value)}
        className="sm:w-56"
        aria-label="Filter by alert type"
      >
        <option value="">All types</option>
        {ALERT_TYPES.map((type) => (
          <option key={type} value={type}>
            {type.replaceAll("_", " ")}
          </option>
        ))}
      </Select>
    </div>
  );
}
