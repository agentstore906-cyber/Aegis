import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BehavioralDeviation } from "@prisma/client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children as never}
    </a>
  ),
}));

import { BehaviorDetails, BehaviorSummary } from "@/components/behavior/behavior-view";
import { buildProfile } from "@/lib/behavior/profile";

const windowEnd = new Date("2026-10-03T00:00:00.000Z");
const windowStart = new Date("2026-09-05T00:00:00.000Z");
const { profile } = buildProfile({
  windowStart,
  windowEnd,
  categorical: [
    { dimension: "tool", key: "crm", count: 360, daysSeen: 20, firstSeen: windowStart, lastSeen: windowEnd },
    { dimension: "destination", key: "api.crm.example.com", count: 300, daysSeen: 20, firstSeen: windowStart, lastSeen: windowEnd },
    { dimension: "destination", key: "once.example.com", count: 1, daysSeen: 1, firstSeen: windowStart, lastSeen: windowEnd },
  ],
  hourlyTotals: [{ hourStart: new Date("2026-10-02T09:00:00Z"), count: 2 }],
  excludedHours: new Set(),
  recordCounts: [10, 10, 12],
  byteCounts: [],
});
const meta = (maturity: "NEW_AGENT" | "LIMITED_HISTORY" | "ESTABLISHED") => ({
  version: 4,
  maturity,
  windowStart,
  windowEnd,
  eventsObserved: maturity === "NEW_AGENT" ? 12 : 360,
  activeDays: maturity === "NEW_AGENT" ? 1 : 20,
  computedAt: windowEnd,
});

const deviation = {
  id: "dev_1",
  kind: "NEW_DESTINATION",
  confidence: "HIGH",
  explanation: 'New destination: this agent used "files.example-share.io". It was never seen in the last 28 days.',
  eventId: "evt_1",
  occurrences: 3,
  lastSeenAt: new Date("2026-10-03T10:00:00Z"),
} as unknown as BehavioralDeviation;

describe("<BehaviorDetails>", () => {
  it("answers 'what is normal' from the profile and 'what has changed' from real deviations", () => {
    const html = renderToStaticMarkup(<BehaviorDetails meta={meta("ESTABLISHED")} profile={profile} deviations={[deviation]} />);
    expect(html).toContain("What is normal for this agent");
    expect(html).toContain("api.crm.example.com");
    expect(html).toContain("1 seen but not yet normal");
    expect(html).toContain("What has changed");
    expect(html).toContain("files.example-share.io");
    expect(html).toContain("3× that day");
    expect(html).toContain('href="/activity/evt_1"');
    expect(html).toContain("deviations don’t block actions or raise alerts");
    expect(html).toContain("Learning window 2026-09-05 – 2026-10-02 (UTC days");
  });

  it("is honest during cold start — no claims of normal, no fabricated changes", () => {
    const html = renderToStaticMarkup(<BehaviorDetails meta={meta("NEW_AGENT")} profile={profile} deviations={[]} />);
    expect(html).toContain("New agent — learning");
    expect(html).toContain("not enough to say what&#x27;s normal");
    expect(html).toContain("Nothing is compared until a baseline exists.");
  });
});

describe("<BehaviorSummary>", () => {
  it("shows maturity, the recent change count, and links to the Behavior tab", () => {
    const html = renderToStaticMarkup(<BehaviorSummary slug="billing-agent" meta={meta("LIMITED_HISTORY")} deviationCount={2} />);
    expect(html).toContain("Limited history");
    expect(html).toContain("2 behavioral changes recorded in the last 7 days");
    expect(html).toContain('href="/agents/billing-agent?tab=behavior"');
  });
});
