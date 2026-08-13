"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";
import { AUDIT_RANGES, AUDIT_RESULTS } from "@/lib/validation/audit";

export function AuditFilters({
  eventTypes,
  agents,
  actors,
}: {
  eventTypes: string[];
  agents: { id: string; name: string }[];
  actors: { id: string; name: string | null; email: string }[];
}) {
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
        defaultValue={searchParams.get("eventType") ?? ""}
        onChange={(e) => updateParam("eventType", e.target.value)}
        className="sm:w-52"
        aria-label="Filter by event type"
      >
        <option value="">All event types</option>
        {eventTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("actorUserId") ?? ""}
        onChange={(e) => updateParam("actorUserId", e.target.value)}
        className="sm:w-48"
        aria-label="Filter by actor"
      >
        <option value="">All actors</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name ?? actor.email}
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
        defaultValue={searchParams.get("result") ?? ""}
        onChange={(e) => updateParam("result", e.target.value)}
        className="sm:w-36"
        aria-label="Filter by result"
      >
        <option value="">Any result</option>
        {AUDIT_RESULTS.map((result) => (
          <option key={result} value={result}>
            {result.charAt(0) + result.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={searchParams.get("range") ?? ""}
        onChange={(e) => updateParam("range", e.target.value)}
        className="sm:w-32"
        aria-label="Filter by date range"
      >
        {AUDIT_RANGES.map((range) => (
          <option key={range} value={range}>
            {range === "all" ? "All time" : `Last ${range}`}
          </option>
        ))}
      </Select>
    </div>
  );
}
