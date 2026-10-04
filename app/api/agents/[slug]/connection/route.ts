import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getActiveMembership } from "@/lib/organizations/queries";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/agents/:slug/connection — the connection state the setup screen polls while it waits for an agent.
 * Session-authenticated and scoped to the caller's ACTIVE organization (from the membership, never the request).
 * Everything returned is derived from stored evidence (lib/agents/connection-state.ts); it contains no secrets.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  const membership = await getActiveMembership(user.id);
  if (!membership) return NextResponse.json({ error: "No organization." }, { status: 403, headers: NO_STORE });

  const { slug } = await params;
  try {
    const snapshot = await getAgentConnectionSnapshot(membership.organization.id, slug);
    if (!snapshot) return NextResponse.json({ error: "Agent not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    console.error(JSON.stringify({ msg: "connection_status_failed", error: String(error) }));
    return NextResponse.json({ error: "Connection status is unavailable right now." }, { status: 503, headers: NO_STORE });
  }
}
