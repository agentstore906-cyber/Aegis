import "server-only";

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { resolveSafeWebhookTarget } from "@/lib/webhooks/ssrf";

/** Outbound webhook responses are only inspected for their status; a body is never needed, so very little is read. */
export const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

export type WebhookPostResult = { status: number };

/**
 * POSTs a webhook delivery to a user-supplied URL without letting that URL reach anything internal:
 *   - the destination is validated by `resolveSafeWebhookTarget` (scheme, credentials, every resolved address public);
 *   - the connection is made to THAT validated address (custom `lookup`), with TLS/SNI and the Host header still using
 *     the original hostname — so DNS rebinding between validation and connection is impossible (no second lookup);
 *   - redirects are NEVER followed: a 3xx is returned as an ordinary non-2xx status and its Location is ignored;
 *   - one overall deadline covers connect, TLS, request and response (not just socket idleness), and the response body
 *     is capped and discarded.
 * Throws `UnsafeWebhookUrlError` for a rejected destination, or a plain Error for network failures/timeouts.
 */
export async function postWebhook(rawUrl: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<WebhookPostResult> {
  const { url, address, family } = await resolveSafeWebhookTarget(rawUrl);
  const isHttps = url.protocol === "https:";

  return new Promise<WebhookPostResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };

    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        method: "POST",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname || "/"}${url.search}`,
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)), "user-agent": "Aegis-Webhooks/1" },
        // Connect to the address that was validated, not whatever the name resolves to now.
        lookup: (_host: string, options: unknown, cb: (...args: unknown[]) => void) => {
          if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
        agent: false,
      } as never,
      (res) => {
        const status = res.statusCode ?? 0;
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_WEBHOOK_RESPONSE_BYTES) res.destroy();
        });
        res.on("error", () => {});
        // The status is all that matters; settle as soon as headers arrive and drain the rest within the cap.
        finish(() => resolve({ status }));
        res.resume();
      }
    );

    const deadline = setTimeout(() => {
      finish(() => reject(new Error("Webhook delivery timed out.")));
      req.destroy();
    }, timeoutMs);

    req.on("error", (error) => finish(() => reject(error)));
    req.end(body);
  });
}
