import "server-only";

import { prisma } from "@/lib/db";

/**
 * Agent Arena funnel analytics. Persisted (unlike the dev-only console stub
 * in lib/analytics/track.ts) so the viral-loop metrics — Challenge Rate,
 * Challenge Conversion, Viral K-Factor — can be derived from real data in
 * lib/arena/metrics.ts.
 *
 * Never pass anything sensitive in `properties`: no API keys, prompts,
 * agent names/slugs, model names, resources, or customer data.
 */
export type ArenaAnalyticsEventName =
  | "arena_viewed"
  | "benchmark_started"
  | "benchmark_completed"
  | "score_generated"
  | "scorecard_viewed"
  | "scorecard_shared"
  | "scorecard_made_public"
  | "challenge_created"
  | "challenge_clicked"
  | "challenge_completed"
  | "challenge_signup"
  | "connect_agent_from_challenge";

type Props = Record<string, string | number | boolean | null | undefined>;

export async function trackArenaEvent(
  event: ArenaAnalyticsEventName,
  opts: { organizationId?: string; scorecardId?: string; properties?: Props } = {}
): Promise<void> {
  try {
    await prisma.arenaAnalyticsEvent.create({
      data: {
        event,
        organizationId: opts.organizationId ?? null,
        scorecardId: opts.scorecardId ?? null,
        properties: opts.properties
          ? (JSON.parse(JSON.stringify(opts.properties)) as Props)
          : undefined,
      },
    });
  } catch (error) {
    // Analytics must never break a user flow.
    console.error(JSON.stringify({ msg: "arena_analytics_failed", event, error: String(error) }));
  }
}
