"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleCopy}
      className={cn(className)}
    >
      {copied ? (
        <>
          <Check className="size-3.5" aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  );
}
