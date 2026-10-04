import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getActiveMembership } from "@/lib/organizations/queries";
import { searchWorkspace } from "@/lib/search/service";

/**
 * GET /api/search?q= — global search for the signed-in user's ACTIVE organization (the command palette).
 * Session-authenticated like every dashboard surface; it is not part of the public API-key surface. The
 * organization and role come from the membership, never from the request. A missing session is a 401 JSON
 * response (not a redirect), so the palette can say "sign in again" instead of choking on an HTML page.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const membership = await getActiveMembership(user.id);
  if (!membership) return NextResponse.json({ error: "No organization." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const result = await searchWorkspace({ organizationId: membership.organization.id, role: membership.role }, q);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ msg: "search_failed", error: String(error) }));
    // Truthful: the search did not run, so no (partial) results are returned.
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
