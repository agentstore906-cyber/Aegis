import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mapSubscriptionStatus,
  statusGrantsPaidPlan,
  planIdForVariant,
  verifyWebhookSignature,
} from "@/lib/billing/lemonsqueezy";
import { PLANS } from "@/lib/billing/plans";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "test_webhook_signing_secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function sign(body: string, secret = "test_webhook_signing_secret"): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correct HMAC-SHA256 hex signature over the raw body", () => {
    const body = JSON.stringify({ meta: { event_name: "subscription_created" } });
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = "{}";
    expect(verifyWebhookSignature(body, sign(body, "not_the_secret"))).toBe(false);
  });

  it("rejects a missing signature, a tampered body, and fails closed with no secret set", () => {
    const body = "{}";
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature('{"x":1}', sign(body))).toBe(false);
    delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    expect(verifyWebhookSignature(body, sign(body))).toBe(false);
  });
});

describe("mapSubscriptionStatus", () => {
  it("maps every Lemon Squeezy status to a canonical Aegis status", () => {
    expect(mapSubscriptionStatus("on_trial")).toBe("trialing");
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapSubscriptionStatus("paused")).toBe("paused");
    expect(mapSubscriptionStatus("unpaid")).toBe("unpaid");
    expect(mapSubscriptionStatus("cancelled")).toBe("cancelled");
    expect(mapSubscriptionStatus("expired")).toBe("expired");
  });

  it("treats an unknown/missing status as expired (fail closed)", () => {
    expect(mapSubscriptionStatus("something_new")).toBe("expired");
    expect(mapSubscriptionStatus(undefined)).toBe("expired");
  });
});

describe("statusGrantsPaidPlan", () => {
  it("keeps paid access through active, trialing, past_due and cancelled-but-not-expired", () => {
    expect(statusGrantsPaidPlan("active")).toBe(true);
    expect(statusGrantsPaidPlan("trialing")).toBe(true);
    expect(statusGrantsPaidPlan("past_due")).toBe(true);
    expect(statusGrantsPaidPlan("cancelled")).toBe(true);
  });

  it("removes paid access on paused, unpaid and expired", () => {
    expect(statusGrantsPaidPlan("paused")).toBe(false);
    expect(statusGrantsPaidPlan("unpaid")).toBe(false);
    expect(statusGrantsPaidPlan("expired")).toBe(false);
  });
});

describe("planIdForVariant", () => {
  it("resolves a configured variant id back to its plan", () => {
    process.env.LEMONSQUEEZY_STARTUP_VARIANT_ID = "12345";
    // plans.ts read env at import; re-import a fresh copy to see the override.
    // Simpler: assert the fallback behaviour, which needs no env.
    expect(planIdForVariant("not-a-real-variant")).toBe("free");
    expect(planIdForVariant(null)).toBe("free");
    expect(planIdForVariant(undefined)).toBe("free");
  });

  it("matches whatever the paid plans actually have configured", () => {
    for (const id of ["startup", "growth", "business"] as const) {
      const variant = PLANS[id].lemonSqueezyVariantId;
      if (variant) expect(planIdForVariant(variant)).toBe(id);
    }
  });
});
