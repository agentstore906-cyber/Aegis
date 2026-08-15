"use client";

import { useTransition } from "react";
import type { FeatureRequestStatus } from "@prisma/client";

import { setFeatureRequestStatusAction } from "@/lib/feedback/actions";
import { Select } from "@/components/ui/field";
import { FEATURE_REQUEST_STATUSES } from "@/lib/validation/feedback";

export function FeatureRequestStatusSelect({ id, status }: { id: string; status: FeatureRequestStatus }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Feature request status"
      value={status}
      disabled={pending}
      className="h-8 text-xs"
      onChange={(event) => {
        const formData = new FormData();
        formData.set("id", id);
        formData.set("status", event.target.value);
        startTransition(() => {
          setFeatureRequestStatusAction(formData);
        });
      }}
    >
      {FEATURE_REQUEST_STATUSES.map((value) => (
        <option key={value} value={value}>
          {value.replace("_", " ")}
        </option>
      ))}
    </Select>
  );
}
