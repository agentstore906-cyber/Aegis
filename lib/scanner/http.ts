import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { getUserMemberships } from "@/lib/organizations/queries";
import { getSessionHash } from "@/lib/scanner/session";
import type { Viewer } from "@/lib/scanner/service";

/**
 * Shared plumbing for the unauthenticated scanner endpoints. Everything here assumes the caller is
 * hostile: bodies are size-capped before parsing, cross-site browser requests are refused, and error
 * responses never echo request content.
 */

export type ApiErrorCode = "invalid_json" | "invalid_input" | "payload_too_large" | "unsupported_media_type" | "rate_limited" | "forbidden_origin" | "not_found" | "server_error";

export function errorResponse(status: number, code: ApiErrorCode, message: string, extra: { fields?: Record<string, string>; retryAfterSeconds?: number } = {}) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (extra.retryAfterSeconds) headers["Retry-After"] = String(Math.max(1, Math.ceil(extra.retryAfterSeconds)));
  return NextResponse.json({ error: { code, message, ...(extra.fields ? { fields: extra.fields } : {}) } }, { status, headers });
}

/**
 * CSRF defence for cookie-authenticated POSTs: a browser always sends Origin on cross-site and
 * same-site POSTs, so a present Origin that doesn't match this host is refused. A missing Origin
 * (curl, server-to-server) can't ride a victim's cookies, so it is allowed.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host !== null && originHost.toLowerCase() === host.toLowerCase();
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: NextResponse };

/** Reads and parses a JSON body with a hard byte cap. Never throws; returns the error response to send. */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<JsonBody> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: errorResponse(415, "unsupported_media_type", "Send the request as application/json.") };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "That request is too large.") };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json", "The request body could not be read.") };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "That request is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json", "The request body is not valid JSON.") };
  }
}

/** Resolves who is asking: the anonymous session (if any) plus the signed-in user and their organizations. Never throws. */
export async function resolveViewer(): Promise<Viewer & { userId: string | null; organizationIds: string[] }> {
  const sessionHash = await getSessionHash();
  try {
    const session = await auth();
    const userId = session?.user?.id ?? null;
    if (!userId) return { sessionHash, userId: null, organizationIds: [] };
    const memberships = await getUserMemberships(userId);
    return { sessionHash, userId, organizationIds: memberships.map((m) => m.organization.id) };
  } catch {
    return { sessionHash, userId: null, organizationIds: [] };
  }
}
