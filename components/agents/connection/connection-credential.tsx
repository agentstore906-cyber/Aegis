"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";

import { CopyButton } from "@/components/ui/copy-button";

/**
 * The agent's credential, shown while it is the only moment it exists. Masked until the user reveals it; the copy
 * button copies the real value either way. It is never put in a URL, never logged, and never sent anywhere from
 * here. Aegis stores only a hash, so closing this screen without copying means issuing a new credential.
 */
export function ConnectionCredential({ secret }: { secret: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <KeyRound className="size-3.5" aria-hidden="true" />
          Agent credential
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {revealed ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
            {revealed ? "Hide" : "Reveal"}
          </button>
          <CopyButton value={secret} />
        </div>
      </div>
      <p className="num mt-3 break-all rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground" data-testid="credential-value">
        {revealed ? secret : "•".repeat(Math.min(secret.length, 40))}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Works only for this agent. Shown once: Aegis keeps a hash, not the key. If you lose it, issue a new one from the agent page.
      </p>
    </div>
  );
}
