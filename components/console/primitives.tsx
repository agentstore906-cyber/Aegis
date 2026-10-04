import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The console's small set of layout primitives. Every page composes these
 * instead of hand-rolling headings, boxes and figures, so spacing, hierarchy
 * and state color stay identical across the product. Server components: no
 * client JavaScript.
 */

export type PanelTone = "neutral" | "safe" | "warning" | "risk" | "blocked" | "approval" | "system";

const ACCENT: Record<PanelTone, string> = {
  neutral: "",
  safe: "border-l-2 border-l-success",
  warning: "border-l-2 border-l-warning",
  risk: "border-l-2 border-l-risk",
  blocked: "border-l-2 border-l-danger",
  approval: "border-l-2 border-l-approval",
  system: "border-l-2 border-l-info",
};

/** A small upper-case label that names a region. Always real text, so it is announced by screen readers. */
export function SectionLabel({ children, className, as: Tag = "h2", id }: { children: React.ReactNode; className?: string; as?: "h2" | "h3" | "p"; id?: string }) {
  return (
    <Tag id={id} className={cn("section-label", className)}>
      {children}
    </Tag>
  );
}

/**
 * A region of the console: a label, an optional action, and content. `tone` draws a thin left accent only when the
 * panel itself represents a state (for example "needs attention"); it is never decorative.
 */
export function Panel({
  label,
  action,
  tone = "neutral",
  flush,
  className,
  children,
  id,
}: {
  label: string;
  action?: React.ReactNode;
  tone?: PanelTone;
  /** No inner padding: for lists and tables that provide their own. */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  const labelId = id ? `${id}-label` : undefined;
  return (
    <section id={id} aria-labelledby={labelId} className={cn("rounded-xl border border-border bg-surface", ACCENT[tone], className)}>
      <header className="flex items-center justify-between gap-3 px-4 pb-1 pt-3.5">
        <SectionLabel id={labelId}>{label}</SectionLabel>
        {action}
      </header>
      <div className={flush ? "border-t border-border mt-2.5" : "px-4 pb-4 pt-2"}>{children}</div>
    </section>
  );
}

/** "View all →" style link used in panel headers. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
      {children}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Link>
  );
}

const VALUE_TONE: Record<PanelTone, string> = {
  neutral: "text-foreground",
  safe: "text-success",
  warning: "text-warning",
  risk: "text-risk",
  blocked: "text-danger",
  approval: "text-approval",
  system: "text-info",
};

/**
 * One figure with its label. The value is whatever the caller passes — always a count or measurement read from the
 * application's own data. `tone` colors the value only when the caller says the number is a state worth noticing
 * (a zero is never colored).
 */
export function Metric({
  label,
  value,
  caption,
  tone = "neutral",
  href,
  className,
}: {
  label: string;
  value: string | number;
  caption?: string;
  tone?: PanelTone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <p className="section-label">{label}</p>
      <p className={cn("num mt-1 text-3xl font-semibold leading-none tracking-tight", VALUE_TONE[tone])}>{value}</p>
      {caption && <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>}
    </>
  );
  const base = "block rounded-xl px-1 py-2";
  return href ? (
    <Link href={href} className={cn(base, "focus-ring -mx-1 px-2 transition-colors hover:bg-surface-muted", className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(base, className)}>{body}</div>
  );
}

/** A state dot + words. The words always carry the meaning; the color only reinforces it. */
export function StateLine({ tone, children, className }: { tone: PanelTone; children: React.ReactNode; className?: string }) {
  const dot: Record<PanelTone, string> = {
    neutral: "bg-muted-foreground",
    safe: "bg-success",
    warning: "bg-warning",
    risk: "bg-risk",
    blocked: "bg-danger",
    approval: "bg-approval",
    system: "bg-info",
  };
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-foreground", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", dot[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}
