import type { RiskScore } from "@/lib/security/risk-score";
import { cn } from "@/lib/utils";

/**
 * Renders the transparent Agent Risk Score (Phase 2 spec §3) — the number
 * is never shown without the reasons behind it, so "why is this 78?" is
 * always answerable on the same screen.
 */
export function AgentRiskScore({ risk }: { risk: RiskScore }) {
  const tone = scoreTone(risk.score);

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tabular-nums", tone.text)}>{risk.score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
      </div>
      {risk.factors.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No risk factors detected — nothing unusual, blocked, denied, or destructive in this agent&apos;s recent
          activity.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {risk.factors.map((factor) => (
            <li key={factor.label} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <span className={cn("mt-1 size-1 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
              <span>{factor.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function scoreTone(score: number): { text: string; dot: string } {
  if (score >= 75) return { text: "text-danger", dot: "bg-danger" };
  if (score >= 50) return { text: "text-warning", dot: "bg-warning" };
  if (score >= 25) return { text: "text-info", dot: "bg-info" };
  return { text: "text-success", dot: "bg-success" };
}
