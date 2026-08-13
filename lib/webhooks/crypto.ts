import "server-only";

import { createHmac, randomBytes } from "node:crypto";

const SECRET_BYTES = 24;

/** Same one-time-reveal treatment as ApiKey — only the value returned at creation time is ever shown. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/** HMAC-SHA256 of the exact raw JSON body — sent as the `X-Aegis-Signature` header so receivers can verify authenticity. */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
