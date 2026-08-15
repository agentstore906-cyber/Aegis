"use client";

import { useTransition } from "react";
import type { LeadStatus } from "@prisma/client";

import { setLeadStatusAction } from "@/lib/leads/actions";
import { Select } from "@/components/ui/field";
import { LEAD_STATUSES } from "@/lib/validation/lead";

export function LeadStatusSelect({ id, status }: { id: string; status: LeadStatus }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Lead status"
      value={status}
      disabled={pending}
      className="h-8 text-xs"
      onChange={(event) => {
        const formData = new FormData();
        formData.set("id", id);
        formData.set("status", event.target.value);
        startTransition(() => {
          setLeadStatusAction(formData);
        });
      }}
    >
      {LEAD_STATUSES.map((value) => (
        <option key={value} value={value}>
          {value.replace("_", " ")}
        </option>
      ))}
    </Select>
  );
}
