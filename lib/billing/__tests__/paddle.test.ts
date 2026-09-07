import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mapSubscriptionStatus,
  statusGrantsPaidPlan,
  planIdForPriceId,
  verifyAndUnmarshalWebhook,
} from "@/lib/billing/paddle";
import { PLANS } from "@/lib/billing/plans";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PADDLE_API_KEY = "pdl_test_fake_key";
  process.env.PADDLE_WEBHOOK_SECRET = "test_webhook_signing_secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Builds a `Paddle-Signature` header exactly as Paddle does: HMAC-SHA256 of `ts:rawBody`, hex-encoded. */
function paddleSignature(body: string, secret = "test_webhook_signing_secret", ts = Math.floor(Date.now() / 1000)): string {
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("verifyAndUnmarshalWebhook", () => {
  it("accepts a correctly-signed event and returns the parsed entity", async () => {
    const body = JSON.stringify({
      event_id: "evt_1",
      notification_id: "ntf_1",
      event_type: "subscription.created",
      occurred_at: new Date().toISOString(),
      data: {
        id: "sub_1",
        status: "active",
        customer_id: "ctm_1",
        billing_cycle: { interval: "month", frequency: 1 },
        items: [],
      },
    });
    const result = await verifyAndUnmarshalWebhook(body, paddleSignature(body));
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe("subscription.created");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = JSON.stringify({ event_id: "evt_2", event_type: "subscription.updated", data: {} });
    const result = await verifyAndUnmarshalWebhook(body, paddleSignature(body, "not_the_secret"));
    expect(result).toBeNull();
  });

  it("rejects a missing signature and fails closed with no secret set", async () => {
    const body = "{}";
    expect(await verifyAndUnmarshalWebhook(body, null)).toBeNull();
    delete process.env.PADDLE_WEBHOOK_SECRET;
    expect(await verifyAndUnmarshalWebhook(body, paddleSignature(body))).toBeNull();
  });

  it("rejects a tampered body signed for a different payload", async () => {
    const signed = paddleSignature("original");
    const result = await verifyAndUnmarshalWebhook("tampered", signed);
    expect(result).toBeNull();
  });
});

describe("mapSubscriptionStatus", () => {
  it("maps every Paddle status to a canonical Aegis status", () => {
    expect(mapSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapSubscriptionStatus("paused")).toBe("paused");
    expect(mapSubscriptionStatus("canceled")).toBe("cancelled");
  });

  it("treats an unknown/missing status as expired (fail closed)", () => {
    expect(mapSubscriptionStatus("something_new")).toBe("expired");
    expect(mapSubscriptionStatus(undefined)).toBe("expired");
  });
});

describe("statusGrantsPaidPlan", () => {
  it("keeps paid access through active, trialing and past_due", () => {
    expect(statusGrantsPaidPlan("active")).toBe(true);
    expect(statusGrantsPaidPlan("trialing")).toBe(true);
    expect(statusGrantsPaidPlan("past_due")).toBe(true);
  });

  it("removes paid access once Paddle reports the subscription as actually ended, paused, or unknown", () => {
    // Paddle has no "cancelled but access continues until period end" status —
    // that pending state is a scheduled_change on an active subscription
    // (see lib/billing/sync.ts). By the time status is `canceled`, access is
    // genuinely over.
    expect(statusGrantsPaidPlan("cancelled")).toBe(false);
    expect(statusGrantsPaidPlan("paused")).toBe(false);
    expect(statusGrantsPaidPlan("expired")).toBe(false);
  });
});

describe("planIdForPriceId", () => {
  it("resolves an unrecognized/missing price id to free", () => {
    expect(planIdForPriceId("not-a-real-price")).toBe("free");
    expect(planIdForPriceId(null)).toBe("free");
    expect(planIdForPriceId(undefined)).toBe("free");
  });

  it("matches whatever the paid plans actually have configured", () => {
    for (const id of ["startup", "growth", "business"] as const) {
      const priceId = PLANS[id].paddlePriceId;
      if (priceId) expect(planIdForPriceId(priceId)).toBe(id);
    }
  });
});
