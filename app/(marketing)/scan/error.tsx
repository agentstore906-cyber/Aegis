"use client";

import { ErrorState } from "@/components/ui/error-state";
import { Button, ButtonLink } from "@/components/ui/button";

/** Shown instead of a blank screen if anything under /scan throws. Says what happened and what is safe. */
export default function ScanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <ErrorState
        title="The scanner hit a problem."
        what="Something went wrong while loading this page."
        dataNote="Nothing was run against your agent, and nothing you entered was stored by this error. Your report, if you had one, is unchanged."
        reference={error.digest}
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href="/scan" size="sm" variant="secondary">
              Start over
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
