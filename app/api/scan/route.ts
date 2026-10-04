import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { getClientIp } from "@/lib/http/client-ip";
import { getActiveMembership } from "@/lib/organizations/queries";
import { LIMITS } from "@/lib/scanner/catalog";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import { errorResponse, isSameOrigin, readJsonBody } from "@/lib/scanner/http";
import { scanCreateDaily, scanCreateHourly, scanCreateSession } from "@/lib/scanner/rate-limit";
import { createScan } from "@/lib/scanner/service";
import { ensureSessionHash } from "@/lib/scanner/session";
import { parseScanRequest } from "@/lib/scanner/validation";

/**
 * POST /api/scan — runs a scan and stores it. No account required.
 *
 * The scanner analyses a DESCRIPTION of an agent. It never executes, fetches, or forwards anything
 * the visitor supplies. Order matters: cheap rejections (origin, size, type, rate) come before any
 * parsing or database work.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse(403, "forbidden_origin", "This request was not accepted from that origin.");

  const ip = await getClientIp();
  for (const limiter of [scanCreateHourly, scanCreateDaily]) {
    const limit = await limiter.consume(ip);
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "You have run a lot of scans recently. Please try again a little later.", {
        retryAfterSeconds: (limit.resetAt.getTime() - Date.now()) / 1000,
      });
    }
  }

  const body = await readJsonBody(request, LIMITS.maxBodyBytes);
  if (!body.ok) return body.response;

  const parsed = parseScanRequest(body.value);
  if (!parsed.ok) return errorResponse(422, "invalid_input", "Some answers were not valid. Please check them and try again.", { fields: parsed.errors });

  try {
    const sessionHash = await ensureSessionHash();
    const bySession = await scanCreateSession.consume(sessionHash);
    if (!bySession.allowed) {
      return errorResponse(429, "rate_limited", "You have run a lot of scans recently. Please try again a little later.", {
        retryAfterSeconds: (bySession.resetAt.getTime() - Date.now()) / 1000,
      });
    }

    // A signed-in user running a scan from the dashboard owns it immediately.
    let userId: string | null = null;
    let organizationId: string | null = null;
    try {
      const session = await auth();
      if (session?.user?.id) {
        const membership = await getActiveMembership(session.user.id);
        if (membership) {
          userId = session.user.id;
          organizationId = membership.organization.id;
        }
      }
    } catch {
      // Treat any auth failure as anonymous.
    }

    const { id, result } = await createScan({ input: parsed.input, sessionHash, userId, organizationId });

    await trackScannerEvent("scan_generated", { visitorHash: sessionHash, scanId: id, organizationId, properties: { level: result.level, score: result.score, highRisk: result.counts.high, agentType: parsed.input.agentType } });
    if (result.counts.high > 0) await trackScannerEvent("high_risk_detected", { visitorHash: sessionHash, scanId: id, organizationId, properties: { highRisk: result.counts.high } });

    return NextResponse.json({ id, reportUrl: userId ? `/risk-scan/${id}` : `/scan/report/${id}`, score: result.score, level: result.level }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never log request content; the error name is enough to triage.
    console.error(JSON.stringify({ msg: "scan_create_failed", error: error instanceof Error ? error.name : "error" }));
    return errorResponse(500, "server_error", "We couldn’t complete the scan. Your answers weren’t lost on your device — please try again.");
  }
}
