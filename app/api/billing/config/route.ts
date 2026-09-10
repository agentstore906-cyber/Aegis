import { NextResponse } from "next/server";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { resolvePaddleEnvironmentForLog, logPaddleEnvDiagnosticsOnce } from "@/lib/billing/paddle";

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

  logPaddleEnvDiagnosticsOnce();

  const clientToken = process.env.PADDLE_CLIENT_TOKEN?.trim() || null;
  const environment = resolvePaddleEnvironmentForLog();

  if (!clientToken || environment === "invalid") {
    // Paddle.js can't be initialized without both of these. Log which one
    // is missing (never the token value) so a browser that shows "Could not
    // start checkout" has a matching server-side line.
    console.error(
      JSON.stringify({
        msg: "billing_config_unavailable",
        operation: "checkout_config",
        provider: "paddle",
        environment,
        clientTokenPresent: Boolean(clientToken),
      })
    );
    return NextResponse.json({ error: "Paddle is not configured in this environment." }, { status: 404 });
  }

  return NextResponse.json({ clientToken, environment });
}
