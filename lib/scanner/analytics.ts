import "server-only";

import { prisma } from "@/lib/db";

/**
 * Persisted scanner funnel analytics (lib/analytics/track.ts is a dev-only console stub). Funnel
 * performance only — never scan content: no answers, no pasted text, no labels, no IPs. Properties
 * are reduced to a small allowlisted scalar set so nothing sensitive can be smuggled in.
 */
export const SCANNER_EVENTS = [
  "scanner_viewed",
  "scanner_started",
  "scanner_step_completed",
  "scanner_completed",
  "scan_generated",
  "high_risk_detected",
  "report_viewed",
  "report_shared",
  "signup_started",
  "signup_completed",
  "connect_aegis_clicked",
  "scan_claimed",
  "agent_connected",
  "trial_started",
  "subscription_started",
] as const;
export type ScannerEventName = (typeof SCANNER_EVENTS)[number];

/** Events the browser may report itself. Everything else is recorded server-side only. */
export const CLIENT_EVENTS = ["scanner_viewed", "scanner_started", "scanner_step_completed", "scanner_completed", "report_shared"] as const;

const PROPERTY_KEYS = ["step", "source", "level", "score", "highRisk", "channel", "agentType", "outcome", "from"] as const;
const SAFE_VALUE = /^[a-z0-9_.:-]{1,40}$/i;

export type ScannerProps = Partial<Record<(typeof PROPERTY_KEYS)[number], string | number | boolean | null>>;

export function sanitizeProps(input: unknown): Record<string, string | number | boolean> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const key of PROPERTY_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(value)));
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && SAFE_VALUE.test(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function trackScannerEvent(
  event: ScannerEventName,
  opts: { visitorHash?: string | null; scanId?: string | null; organizationId?: string | null; properties?: unknown } = {}
): Promise<void> {
  try {
    await prisma.scannerAnalyticsEvent.create({
      data: {
        event,
        visitorHash: opts.visitorHash ? opts.visitorHash.slice(0, 16) : null,
        scanId: opts.scanId ?? null,
        organizationId: opts.organizationId ?? null,
        properties: sanitizeProps(opts.properties),
      },
    });
  } catch (error) {
    // Analytics must never break a user flow, and the error text must not carry request content.
    console.error(JSON.stringify({ msg: "scanner_analytics_failed", event, error: error instanceof Error ? error.name : "error" }));
  }
}

/**
 * Downstream conversion attribution (trial / subscription). Records the event against the scan that
 * brought this organization in — and only if there is one — so the funnel can be read end to end.
 * Never throws: billing code calls this and must not be affected by it.
 */
export async function attributeToScanner(organizationId: string, event: "trial_started" | "subscription_started" | "agent_connected"): Promise<void> {
  try {
    const scan = await prisma.riskScan.findFirst({ where: { organizationId, claimedAt: { not: null } }, orderBy: { claimedAt: "asc" }, select: { id: true } });
    if (!scan) return;
    await trackScannerEvent(event, { organizationId, scanId: scan.id, properties: { source: "attribution" } });
  } catch {
    // ignore
  }
}
