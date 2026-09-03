import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPublicScorecardId } from "@/lib/arena/queries";
import { createChallengeAttribution } from "@/lib/arena/challenge";
import { trackArenaEvent } from "@/lib/arena/analytics";

/**
 * "Challenge This Agent" entry point. Records challenge attribution in a
 * cookie that survives signup/login, then routes the visitor to connect an
 * agent — new visitors through sign-up, existing users straight to the
 * Arena.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const scorecardId = await getPublicScorecardId(slug);
  if (!scorecardId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  await createChallengeAttribution(scorecardId);
  await trackArenaEvent("challenge_created", { scorecardId, properties: { slug } });

  const user = await getCurrentUser();
  if (!user) {
    // This click will route through account creation before the benchmark.
    await trackArenaEvent("challenge_signup", { scorecardId, properties: { slug } });
    return NextResponse.redirect(new URL("/sign-up", request.url));
  }

  return NextResponse.redirect(new URL("/arena", request.url));
}
