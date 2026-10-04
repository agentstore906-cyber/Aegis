import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "risk" | "danger" | "approval" | "info" | "brand";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-foreground border-border",
  success: "bg-success-bg text-success border-success-border",
  warning: "bg-warning-bg text-warning border-warning-border",
  risk: "bg-risk-bg text-risk border-risk-border",
  danger: "bg-danger-bg text-danger border-danger-border",
  approval: "bg-approval-bg text-approval border-approval-border",
  info: "bg-info-bg text-info border-info-border",
  brand: "bg-brand/10 text-brand border-brand/20",
};

export function Badge({
  tone = "neutral",
  className,
  dot,
  children,
}: {
  tone?: Tone;
  className?: string;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dotClasses[tone])} />}
      {children}
    </span>
  );
}

const dotClasses: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  risk: "bg-risk",
  danger: "bg-danger",
  approval: "bg-approval",
  info: "bg-info",
  brand: "bg-brand",
};
