import { ArrowRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

/**
 * The conversion moment. It appears after the report, never instead of it: the findings above are
 * fully visible without an account. "Aegis" is introduced as what turns a point-in-time scan into
 * ongoing monitoring and control — without claiming it protects anything it doesn't.
 */
export function ConversionPanel({ scanId, highRisk, mediumRisk }: { scanId: string; highRisk: number; mediumRisk: number }) {
  const headline =
    highRisk > 0
      ? `Your agent has ${highRisk} high-risk ${highRisk === 1 ? "behavior" : "behaviors"}.`
      : mediumRisk > 0
        ? `Your agent has ${mediumRisk} medium-risk ${mediumRisk === 1 ? "behavior" : "behaviors"}.`
        : "Keep this assessment current as your agent changes.";
  return (
    <section aria-labelledby="convert" className="rounded-xl border border-border-strong bg-surface-muted p-6 sm:p-8">
      <h2 id="convert" className="text-xl font-semibold tracking-tight text-foreground">
        {headline}
      </h2>
      <p className="mt-2 max-w-xl text-foreground">A scan tells you what is risky. Aegis helps you continuously monitor and control it.</p>
      <ul className="mt-4 max-w-xl space-y-1.5 text-sm text-muted-foreground">
        <li>Record every decision and reported action in an audit trail that can’t be edited afterwards.</li>
        <li>Require approval for the actions this scan flagged, for agents that ask Aegis first.</li>
        <li>Pause or stop an agent instantly, and watch it for behavior that departs from its normal.</li>
      </ul>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={`/scan/connect/${scanId}`} size="lg">
          Connect your agent to Aegis
          <ArrowRight className="size-4" aria-hidden="true" />
        </ButtonLink>
        <ButtonLink href="#findings" variant="secondary" size="lg">
          Explore my risk report
        </ButtonLink>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Your report is kept and attached to your new workspace. Aegis enforces decisions only for agents that call it; it doesn’t sit in your agent’s data path.</p>
    </section>
  );
}
