import { NextResponse, type NextRequest } from "next/server";

import { getActiveMembership } from "@/lib/organizations/queries";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import { resolveViewer } from "@/lib/scanner/http";
import { claimScansForSession, getScanForViewer } from "@/lib/scanner/service";
import { prisma } from "@/lib/db";

/**
 * "Connect your agent to Aegis" entry point. The anonymous browser session already owns the scan, so
 * nothing needs to travel through the sign-up form: whichever way the visitor gets into an account
 * (sign-up or sign-in), the dashboard claims the scans made in this browser (see app/(dashboard)/layout.tsx).
 *
 *   signed out        → sign-up (a "from=scan" hint, no scan data in the URL)
 *   signed in, no org → onboarding (the claim happens once they have a workspace)
 *   signed in         → claim now, then straight to "Your Aegis Security Setup"
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await resolveViewer();

  const lookup = await getScanForViewer(id, viewer);
  if (lookup.status !== "ok") return NextResponse.redirect(new URL(`/scan/report/${encodeURIComponent(id)}`, request.url));

  await trackScannerEvent("connect_aegis_clicked", { visitorHash: viewer.sessionHash, scanId: id });

  if (!viewer.userId) {
    await trackScannerEvent("signup_started", { visitorHash: viewer.sessionHash, scanId: id, properties: { from: "scan" } });
    return NextResponse.redirect(new URL("/sign-up?from=scan", request.url));
  }

  const membership = await getActiveMembership(viewer.userId);
  if (!membership) return NextResponse.redirect(new URL("/onboarding", request.url));

  if (viewer.sessionHash && !lookup.scan.userId) {
    const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { createdAt: true } });
    await claimScansForSession({ sessionHash: viewer.sessionHash, userId: viewer.userId, organizationId: membership.organization.id, userCreatedAt: user?.createdAt });
  }
  return NextResponse.redirect(new URL(`/risk-scan/${encodeURIComponent(id)}`, request.url));
}
