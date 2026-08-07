"use client";

import { useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * Accessible confirmation dialog for destructive actions, built on the
 * native <dialog> element so focus-trapping, Escape-to-close, and the
 * backdrop all come from the browser instead of hand-rolled JS.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <span onClick={() => dialogRef.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialogRef}
        className="m-auto rounded-lg border border-border bg-surface p-0 shadow-lg backdrop:bg-foreground/20"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="w-full max-w-sm p-5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await onConfirm();
                  dialogRef.current?.close();
                });
              }}
            >
              {isPending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
