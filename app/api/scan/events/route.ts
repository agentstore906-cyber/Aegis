import { NextResponse, type NextRequest } from "next/server";

import { getClientIp } from "@/lib/http/client-ip";
import { CLIENT_EVENTS, trackScannerEvent } from "@/lib/scanner/analytics";
import { errorResponse, isSameOrigin, readJsonBody } from "@/lib/scanner/http";
import { scanEventsLimiter } from "@/lib/scanner/rate-limit";
import { isScanId } from "@/lib/scanner/service";
import { ensureSessionHash } from "@/lib/scanner/session";

/**
 * POST /api/scan/events — funnel beacons from the browser. Only an allowlist of event names is
 * accepted, properties are reduced to a few allowlisted scalars, and nothing about a scan's
 * content is ever read or stored here.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse(403, "forbidden_origin", "Not accepted from that origin.");

  const limit = await scanEventsLimiter.consume(await getClientIp());
  if (!limit.allowed) return errorResponse(429, "rate_limited", "Too many events.", { retryAfterSeconds: (limit.resetAt.getTime() - Date.now()) / 1000 });

  const body = await readJsonBody(request, 2048);
  if (!body.ok) return body.response;

  const value = body.value as { event?: unknown; scanId?: unknown; props?: unknown } | null;
  const event = typeof value?.event === "string" ? (CLIENT_EVENTS as readonly string[]).find((e) => e === value.event) : undefined;
  if (!event) return errorResponse(422, "invalid_input", "Unknown event.");

  const scanId = typeof value?.scanId === "string" && isScanId(value.scanId) ? value.scanId : null;
  const visitorHash = await ensureSessionHash();
  await trackScannerEvent(event as (typeof CLIENT_EVENTS)[number], { visitorHash, scanId, properties: value?.props });
  return new NextResponse(null, { status: 204 });
}
