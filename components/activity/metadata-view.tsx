function isFlatObject(value: unknown): value is Record<string, string | number | boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function formatKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function MetadataView({ metadata }: { metadata: unknown }) {
  if (metadata == null) {
    return <p className="text-sm text-muted-foreground">No additional metadata for this event.</p>;
  }

  if (isFlatObject(metadata)) {
    const entries = Object.entries(metadata);
    if (entries.length === 0) {
      return <p className="text-sm text-muted-foreground">No additional metadata for this event.</p>;
    }
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{formatKey(key)}</dt>
            <dd className="mt-0.5 break-words text-sm text-foreground">{String(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-surface-muted p-4 text-xs text-foreground">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}
