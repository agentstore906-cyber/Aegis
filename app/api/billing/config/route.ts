import { NextResponse } from "next/server";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { resolvePaddleEnvironment, logPaddleEnvDiagnosticsOnce } from "@/lib/billing/paddle";

/**
 * Hands the browser what it needs to initialize Paddle.js for the checkout
 * overlay: the publishable client-side token and which Paddle environment
 * to talk to. `PADDLE_CLIENT_TOKEN` is Paddle's own publishable token —
 * safe to expose to a browser by design, unlike `PADDLE_API_KEY` (the
 * secret server-side key), which this route never reads or returns.
 * Session-gated like every other dashboard endpoint even though the value
 * itself isn't sensitive, so it's never reachable by a signed-out client.
 *
 * `environment` comes from the shared `resolvePaddleEnvironment()` so the
 * value Paddle.js initializes with can never disagree with the one the
 * server SDK uses — a mismatch there makes Paddle.js refuse to open the
 * overlay ("the supplied token is for a different environment").
 */
export async function GET() {
  await requireActiveOrganization();

  const clientToken = process.env.PADDLE_CLIENT_TOKEN ?? null;

  if (!clientToken) {
    return NextResponse.json({ error: "Paddle is not configured in this environment." }, { status: 404 });
  }

  logPaddleEnvDiagnosticsOnce();
  return NextResponse.json({ clientToken, environment: resolvePaddleEnvironment() });
}
