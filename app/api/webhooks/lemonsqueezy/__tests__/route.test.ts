/**
 * Integration test against the real dev database. Sets fake (never real)
 * Lemon Squeezy credentials so `verifyWebhookSignature` does genuine
 * HMAC-SHA256 verification — no network call to Lemon Squeezy is ever made.
 * This proves signature verification, idempotency, tenant scoping, and the
 * subscription-lifecycle → plan mapping actually work; it does NOT prove a
 * real Lemon Squeezy store's checkout/webhook round trip (see the final
 * report's "remaining manual setup").
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

const TEST_START = new Date();
const RUN_ID = `lstest_${Date.now()}`;
const WEBHOOK_SECRET = "ls_test_fake_webhook_secret_for_signature_verification_only";

process.env.LEMONSQUEEZY_API_KEY = "lsq_test_fake_key";
process.env.LEMONSQUEEZY_STORE_ID = "99999";
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.LEMONSQUEEZY_GROWTH_VARIANT_ID = "GROWTHVAR";
process.env.LEMONSQUEEZY_STARTUP_VARIANT_ID = "STARTUPVAR";

// Imported after env is set — plans.ts resolves variant ids at import time.
const { POST } = await import("@/app/api/webhooks/lemonsqueezy/route");

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

type EventOpts = {
  subId?: string;
  orgId?: string;
  status?: string;
  variantId?: string;
  customerId?: string;
  cancelled?: boolean;
  updatedAt?: string;
  endsAt?: string | null;
};

function eventBody(eventName: string, opts: EventOpts = {}): string {
  return JSON.stringify({
    meta: {
      event_name: eventName,
      custom_data: opts.orgId ? { organization_id: opts.orgId } : undefined,
    },
    data: {
      type: "subscriptions",
      id: opts.subId ?? `sub_${RUN_ID}`,
      attributes: {
        status: opts.status ?? "active",
        variant_id: opts.variantId ?? "GROWTHVAR",
        customer_id: opts.customerId ?? `cust_${RUN_ID}`,
        cancelled: opts.cancelled ?? false,
        renews_at: "2026-12-01T00:00:00.000000Z",
        ends_at: opts.endsAt ?? null,
        created_at: "2026-09-01T00:00:00.000000Z",
        updated_at: opts.updatedAt ?? "2026-09-01T12:00:00.000000Z",
      },
    },
  });
}

function request(body: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["x-signature"] = signature;
  return new Request("http://localhost/api/webhooks/lemonsqueezy", { method: "POST", body, headers });
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.organization.create({ data: { name: "LS Webhook Org A", slug: `${RUN_ID}-a` } }),
    prisma.organization.create({ data: { name: "LS Webhook Org B", slug: `${RUN_ID}-b` } }),
  ]);
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await prisma.billingWebhookEvent.deleteMany({ where: { processedAt: { gte: TEST_START } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.$disconnect();
});

describe("Lemon Squeezy webhook — signature verification", () => {
  it("rejects a request with no X-Signature header", async () => {
    const res = await POST(request(eventBody("subscription_updated", { orgId: orgA })));
    expect(res.status).toBe(400);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const body = eventBody("subscription_updated", { orgId: orgA, subId: `sub_${RUN_ID}_bad` });
    const res = await POST(request(body, sign(body, "wrong_secret")));
    expect(res.status).toBe(400);
  });

  it("accepts a validly-signed event for an unknown org without erroring", async () => {
    const body = eventBody("subscription_updated", {
      subId: `sub_${RUN_ID}_orphan`,
      customerId: "cust_nobody",
      updatedAt: "2026-09-01T00:00:01.000000Z",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);
  });
});

describe("Lemon Squeezy webhook — subscription lifecycle", () => {
  it("subscription_created grants the mapped plan and records the subscription", async () => {
    const body = eventBody("subscription_created", { orgId: orgA, subId: `sub_${RUN_ID}_A` });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("growth");
    expect(org.subscriptionStatus).toBe("active");
    expect(org.lemonSqueezySubscriptionId).toBe(`sub_${RUN_ID}_A`);
    expect(org.cancelAtPeriodEnd).toBe(false);
  });

  it("is idempotent — replaying the same event does not re-apply state", async () => {
    const body = eventBody("subscription_updated", {
      orgId: orgA,
      subId: `sub_${RUN_ID}_A`,
      updatedAt: "2026-09-02T00:00:00.000000Z",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    // Tamper with local state, then replay the byte-identical event.
    await prisma.organization.update({ where: { id: orgA }, data: { plan: "free" } });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("free"); // replay was a no-op, not a re-apply
  });

  it("subscription_cancelled keeps the plan but flags cancel-at-period-end", async () => {
    const body = eventBody("subscription_cancelled", {
      orgId: orgA,
      subId: `sub_${RUN_ID}_A`,
      status: "cancelled",
      cancelled: true,
      endsAt: "2026-12-01T00:00:00.000000Z",
      updatedAt: "2026-09-03T00:00:00.000000Z",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("growth");
    expect(org.subscriptionStatus).toBe("cancelled");
    expect(org.cancelAtPeriodEnd).toBe(true);
  });

  it("subscription_payment_failed marks past_due but keeps the plan", async () => {
    const body = eventBody("subscription_payment_failed", {
      orgId: orgA,
      subId: `sub_${RUN_ID}_A`,
      status: "past_due",
      updatedAt: "2026-09-04T00:00:00.000000Z",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.subscriptionStatus).toBe("past_due");
    expect(org.plan).toBe("growth");
  });

  it("subscription_expired drops the org back to the free plan", async () => {
    const body = eventBody("subscription_expired", {
      orgId: orgA,
      subId: `sub_${RUN_ID}_A`,
      status: "expired",
      updatedAt: "2026-09-05T00:00:00.000000Z",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("free");
    expect(org.subscriptionStatus).toBe("expired");
  });
});

describe("Lemon Squeezy webhook — tenant isolation", () => {
  it("only touches the org named in verified custom_data, never a bystander", async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });

    const body = eventBody("subscription_created", {
      orgId: orgB,
      subId: `sub_${RUN_ID}_B`,
      variantId: "STARTUPVAR",
      updatedAt: "2026-09-06T00:00:00.000000Z",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const orgBRow = await prisma.organization.findUniqueOrThrow({ where: { id: orgB } });
    const orgARow = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });

    expect(orgBRow.plan).toBe("startup");
    expect(orgARow.plan).toBe(before.plan); // unchanged
    expect(orgARow.subscriptionStatus).toBe(before.subscriptionStatus);
  });
});
