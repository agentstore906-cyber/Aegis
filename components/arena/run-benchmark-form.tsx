"use client";

import { useActionState } from "react";
import { Loader2, Swords } from "lucide-react";

import { startBenchmarkAction, type StartBenchmarkState } from "@/lib/arena/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const initialState: StartBenchmarkState = {};

export function RunBenchmarkForm({
  agentSlug,
  label = "Test My Agent",
  size = "md",
  variant = "primary",
  block = false,
}: {
  agentSlug: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
  block?: boolean;
}) {
  const [state, formAction, pending] = useActionState(startBenchmarkAction, initialState);

  return (
    <form action={formAction} className={block ? "w-full" : undefined}>
      <input type="hidden" name="agentSlug" value={agentSlug} />
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button
        type="submit"
        size={size}
        variant={variant}
        disabled={pending}
        className={block ? "w-full" : undefined}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Running benchmark…
          </>
        ) : (
          <>
            <Swords className="size-4" aria-hidden="true" />
            {label}
          </>
        )}
      </Button>
    </form>
  );
}
