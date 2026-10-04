import { NextResponse, type NextRequest } from "next/server";

import { getClientIp } from "@/lib/http/client-ip";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import { errorResponse, isSameOrigin, readJsonBody, resolveViewer } from "@/lib/scanner/http";
import { scanShareLimiter } from "@/lib/scanner/rate-limit";
import { setScanPublic } from "@/lib/scanner/service";

/**
 * POST /api/scan/:id/share  { "public": true | false }
 * Publishes (or withdraws) the public-safe projection of a scan. Only the scan's owner — the browser
 * session that created it, or the account/organization that claimed it — may do this.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return errorResponse(403, "forbidden_origin", "Not accepted from that origin.");

  const limit = await scanShareLimiter.consume(await getClientIp());
  if (!limit.allowed) return errorResponse(429, "rate_limited", "Too many requests.", { retryAfterSeconds: (limit.resetAt.getTime() - Date.now()) / 1000 });

  const body = await readJsonBody(request, 512);
  if (!body.ok) return body.response;
  const wanted = (body.value as { public?: unknown } | null)?.public;
  if (typeof wanted !== "boolean") return errorResponse(422, "invalid_input", "Expected { public: boolean }.");

  const { id } = await ctx.params;
  const viewer = await resolveViewer();
  const result = await setScanPublic(id, viewer, wanted);
  // Same answer for "not yours" and "doesn't exist": ids are not an oracle.
  if (!result.ok) return errorResponse(404, "not_found", "That report isn’t available.");

  if (wanted) await trackScannerEvent("report_shared", { visitorHash: viewer.sessionHash, scanId: id, properties: { channel: "publish" } });
  return NextResponse.json({ public: wanted, path: result.slug ? `/scan/r/${result.slug}` : null }, { headers: { "Cache-Control": "no-store" } });
}
