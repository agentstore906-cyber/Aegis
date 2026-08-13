import { CopyButton } from "@/components/ui/copy-button";

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface-muted">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {language ?? "code"}
        </span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-xs text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
