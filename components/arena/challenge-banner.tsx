import { Swords } from "lucide-react";

import { challengePrompt } from "@/lib/arena/share";

/** Shown on /arena when the visitor arrived from a "Challenge This Agent" link. */
export function ChallengeBanner({
  targetDisplayName,
  targetScore,
}: {
  targetDisplayName: string;
  targetScore: number;
}) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3.5">
      <Swords className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-medium text-foreground">
          You&rsquo;re challenging {targetDisplayName} — {challengePrompt(targetScore)}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Connect an agent and run the benchmark. Your score will be compared against{" "}
          {targetScore}.
        </p>
      </div>
    </div>
  );
}

/** Shown on a scorecard that resulted from a challenge. */
export function BeatBanner({
  myScore,
  targetScore,
}: {
  myScore: number;
  targetScore: number;
}) {
  const won = myScore > targetScore;
  return (
    <div
      className={
        won
          ? "rounded-lg border border-success-border bg-success-bg px-4 py-3 text-sm font-medium text-success"
          : "rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning"
      }
    >
      {won ? `You beat ${targetScore}.` : `${targetScore} still wins.`}
    </div>
  );
}
