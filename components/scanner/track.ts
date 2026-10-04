"use client";

/**
 * Fire-and-forget funnel beacon. Only an allowlisted event name and a few scalar properties are sent;
 * never answers, pasted text or labels. A failure here must never affect the scanner.
 */
export function sendScannerEvent(event: "scanner_viewed" | "scanner_started" | "scanner_step_completed" | "scanner_completed" | "report_shared", props?: Record<string, string | number | boolean>, scanId?: string): void {
  try {
    void fetch("/api/scan/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, props, scanId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
