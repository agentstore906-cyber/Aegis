import Link from "next/link";
import type { BaselineMaturity, BehavioralDeviation } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { ESTABLISHED_KEY, MATURITY_THRESHOLDS } from "@/lib/behavior/config";
import type { BehaviorProfile, DimensionName, DimensionProfile } from "@/lib/behavior/types";

/**
 * Behavioral memory views (P2). Pure rendering of a baseline the server
 * already computed — no client state. Two questions only:
 * "What is normal for this agent?" and "What has changed?".
 */

type BaselineMeta = {
  version: number;
  maturity: BaselineMaturity;
  windowStart: Date;
  windowEnd: Date;
  eventsObserved: number;
  activeDays: number;
  computedAt: Date;
};

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

const MATURITY_LABEL: Record<BaselineMaturity, string> = {
  NEW_AGENT: "New agent — learning",
  LIMITED_HISTORY: "Limited history",
  ESTABLISHED: "Established baseline",
};

const MATURITY_TONE: Record<BaselineMaturity, "neutral" | "info" | "success"> = {
  NEW_AGENT: "neutral",
  LIMITED_HISTORY: "info",
  ESTABLISHED: "success",
};

function maturityExplanation(meta: BaselineMeta): string {
  const seen = `${meta.eventsObserved.toLocaleString()} events on ${meta.activeDays} day${meta.activeDays === 1 ? "" : "s"}`;
  const { limited, established } = MATURITY_THRESHOLDS;
  switch (meta.maturity) {
    case "NEW_AGENT":
      return `Aegis has seen ${seen} in its learning window — not enough to say what's normal (needs ${limited.minEvents}+ events on ${limited.minActiveDays}+ days). Nothing is compared yet.`;
    case "LIMITED_HISTORY":
      return `Based on ${seen}. Only first-time tools, destinations, data types, and similar are flagged, at low confidence; volume, frequency, and timing need ${established.minEvents}+ events on ${established.minActiveDays}+ days.`;
    case "ESTABLISHED":
      return `Based on ${seen}. Every behavioral check is active.`;
  }
}

export function MaturityBadge({ maturity }: { maturity: BaselineMaturity }) {
  return <Badge tone={MATURITY_TONE[maturity]}>{MATURITY_LABEL[maturity]}</Badge>;
}

/** Compact card for the agent overview. */
export function BehaviorSummary({ slug, meta, deviationCount }: { slug: string; meta: BaselineMeta; deviationCount: number }) {
  return (
    <div className="space-y-2 text-sm">
      <MaturityBadge maturity={meta.maturity} />
      <p className="text-xs text-muted-foreground">{maturityExplanation(meta)}</p>
      <p className="text-xs text-muted-foreground">
        {deviationCount === 0
          ? "No behavioral changes recorded in the last 7 days."
          : `${deviationCount} behavioral change${deviationCount === 1 ? "" : "s"} recorded in the last 7 days.`}{" "}
        <Link href={`/agents/${slug}?tab=behavior`} className="font-medium text-foreground underline">
          View behavior
        </Link>
      </p>
    </div>
  );
}

const NORMAL_DIMENSIONS: { name: DimensionName; label: string }[] = [
  { name: "tool", label: "Tools" },
  { name: "service", label: "Services" },
  { name: "destination", label: "Destinations" },
  { name: "dataClass", label: "Data types" },
  { name: "eventType", label: "Action types" },
  { name: "action", label: "Most common actions" },
  { name: "decision", label: "Policy decisions" },
];

function DimensionList({ label, dim }: { label: string; dim: DimensionProfile | undefined }) {
  if (!dim || dim.observations === 0) {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">Not reported.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">
        {label} · {dim.observations.toLocaleString()} observations
        {dim.highCardinality ? " · too many distinct values to track individually" : ""}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {dim.established.slice(0, 6).map((e) => (
          <li key={e.key} className="flex justify-between gap-3">
            <span className="truncate font-mono text-xs text-foreground">{e.key}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {Math.round(e.share * 100)}% · {e.daysSeen}d
            </span>
          </li>
        ))}
      </ul>
      {dim.established.length === 0 && <p className="text-sm text-muted-foreground">Nothing established yet.</p>}
      {dim.provisional.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          + {dim.provisional.length} seen but not yet normal (needs {ESTABLISHED_KEY.minCount}+ times on {ESTABLISHED_KEY.minDaysSeen}+ days)
        </p>
      )}
    </div>
  );
}

function activeHoursLabel(hourOfDay: number[]): string {
  const active = hourOfDay.map((count, hour) => ({ hour, count })).filter((h) => h.count > 0);
  if (active.length === 0) return "—";
  if (active.length === 24) return "all hours of the day";
  return `${active.length} of 24 hours (UTC): ${active.map((h) => String(h.hour).padStart(2, "0")).join(", ")}`;
}

const DEVIATION_LABEL: Record<string, string> = {
  NEW_TOOL: "New tool",
  NEW_DESTINATION: "New destination",
  NEW_SERVICE: "New service",
  NEW_ACTION_TYPE: "New action type",
  NEW_END_USER: "New end user",
  UNUSUAL_DATA_TYPE: "Unusual data type",
  UNUSUAL_SEQUENCE: "Unusual sequence",
  UNUSUAL_VOLUME: "Unusual volume",
  UNUSUAL_FREQUENCY: "Unusual frequency",
  UNUSUAL_TIME: "Unusual time",
};

/** The Behavior tab. */
export function BehaviorDetails({
  meta,
  profile,
  deviations,
}: {
  meta: BaselineMeta;
  profile: BehaviorProfile;
  deviations: BehavioralDeviation[];
}) {
  const hourly = profile.frequency.activeHour;
  const records = profile.volume.records;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Baseline</CardTitle>
          <MaturityBadge maturity={meta.maturity} />
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground">{maturityExplanation(meta)}</p>
          <p className="text-xs text-muted-foreground">
            Learning window {utcDay(meta.windowStart)} – {utcDay(new Date(meta.windowEnd.getTime() - 1))} (UTC days; today
            is never part of its own baseline) · version {meta.version} · computed {formatRelativeTime(meta.computedAt)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is normal for this agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {NORMAL_DIMENSIONS.map(({ name, label }) => (
              <DimensionList key={name} label={label} dim={profile.dimensions[name]} />
            ))}
          </div>
          <dl className="grid gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Events per active hour</dt>
              <dd>{hourly ? `median ${hourly.median} · p95 ${hourly.p95} · max ${hourly.max}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Active hours</dt>
              <dd className="text-xs">{activeHoursLabel(profile.hourOfDay)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Records per event</dt>
              <dd>{records ? `median ${records.median} · p95 ${records.p95} · max ${records.max}` : "Not reported."}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What has changed</CardTitle>
        </CardHeader>
        <CardContent>
          {deviations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {meta.maturity === "NEW_AGENT"
                ? "Nothing is compared until a baseline exists."
                : "No deviations from this agent's baseline in the last 14 days."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {deviations.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone="warning">{DEVIATION_LABEL[d.kind] ?? d.kind}</Badge>
                    <span>{d.confidence.toLowerCase()} confidence</span>
                    <span>· {formatRelativeTime(d.lastSeenAt)}</span>
                    {d.occurrences > 1 && <span>· {d.occurrences}× that day</span>}
                    {d.eventId && (
                      <Link href={`/activity/${d.eventId}`} className="underline">
                        first event
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-foreground">{d.explanation}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Behavioral evidence only — deviations don&rsquo;t block actions or raise alerts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
