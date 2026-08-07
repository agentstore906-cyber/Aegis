import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pageCount,
  buildHref,
}: {
  page: number;
  pageCount: number;
  buildHref: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        <PageLink
          href={buildHref(page - 1)}
          disabled={prevDisabled}
          label="Previous page"
          icon={ChevronLeft}
        />
        <PageLink href={buildHref(page + 1)} disabled={nextDisabled} label="Next page" icon={ChevronRight} />
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon: Icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: typeof ChevronLeft;
}) {
  const classes = cn(
    "focus-ring flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground",
    disabled ? "pointer-events-none opacity-40" : "hover:bg-surface-muted hover:text-foreground"
  );

  if (disabled) {
    return (
      <span className={classes} aria-disabled="true" aria-label={label}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
    );
  }

  return (
    <Link href={href} className={classes} aria-label={label}>
      <Icon className="size-4" aria-hidden="true" />
    </Link>
  );
}
