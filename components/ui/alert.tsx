import { AlertTriangle, Info, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "danger" | "warning" | "info" | "success";

const toneConfig: Record<Tone, { icon: typeof Info; classes: string }> = {
  danger: { icon: XCircle, classes: "bg-danger-bg border-danger-border text-danger" },
  warning: { icon: AlertTriangle, classes: "bg-warning-bg border-warning-border text-warning" },
  info: { icon: Info, classes: "bg-info-bg border-info-border text-info" },
  success: { icon: CheckCircle2, classes: "bg-success-bg border-success-border text-success" },
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  const { icon: Icon, classes } = toneConfig[tone];
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm", classes)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="text-foreground">{children}</div>
    </div>
  );
}
