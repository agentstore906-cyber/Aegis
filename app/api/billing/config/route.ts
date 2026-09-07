import { NextResponse } from "next/server";

import { requireActiveOrganization } from "@/lib/organizations/queries";

/**
 * Hands the browser what it needs to initialize Paddle.js for the checkout
 * overlay: the publishable client-side token and which Paddle environment
 * to talk to. `PADDLE_CLIENT_TOKEN` is Paddle's own publishable token —
 * safe to expose to a browser by design, unlike `PADDLE_API_KEY` (the
 * secret server-side key), which this route never reads or returns.
 * Session-gated like every other dashboard endpoint even though the value
 * itself isn't sensitive, so it's never reachable by a signed-out client.
 */
export async function GET() {
  await requireActiveOrganization();

  const clientToken = process.env.PADDLE_CLIENT_TOKEN ?? null;
  const environment = process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";

  if (!clientToken) {
    return NextResponse.json({ error: "Paddle is not configured in this environment." }, { status: 404 });
  }

  return NextResponse.json({ clientToken, environment });
}
