/**
 * Integration test against the real dev database. Sets fake (never real)
 * Paddle credentials so `verifyAndUnmarshalWebhook` does genuine
 * `Paddle-Signature` HMAC-SHA256 verification via the official SDK — no
 * network call to Paddle is ever made (the SDK's `webhooks.unmarshal` is
 * pure local signature verification + JSON parsing). This proves signature
 * verification, idempotency, tenant scoping, and the subscription-lifecycle
 * → plan mapping actually work; it does NOT prove a real Paddle sandbox
 * account's checkout/webhook round trip (see the final report's "remaining
 * manual setup").
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

const TEST_START = new Date();
const RUN_ID = `pdltest_${Date.now()}`;
const WEBHOOK_SECRET = "pdl_test_fake_webhook_secret_for_signature_verification_only";

process.env.PADDLE_API_KEY = "pdl_test_fake_key";
process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.PADDLE_ENVIRONMENT = "production";
process.env.PADDLE_GROWTH_PRICE_ID = "pri_growth_test";
process.env.PADDLE_STARTUP_PRICE_ID = "pri_startup_test";

// Imported after env is set — plans.ts resolves price ids at import time.
const { POST } = await import("@/app/api/webhooks/paddle/route");

function sign(body: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): string {
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `evt_${RUN_ID}_${eventCounter}`;
}

type SubEventOpts = {
  subId: string;
  orgId?: string;
  status?: string;
  priceId?: string | null;
  customerId?: string;
  scheduledCancel?: boolean;
  canceledAt?: string | null;
  periodEndsAt?: string | null;
};

function subscriptionEventBody(eventType: string, opts: SubEventOpts): string {
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: `ntf_${RUN_ID}`,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: {
      id: opts.subId,
      status: opts.status ?? "active",
      customer_id: opts.customerId ?? `ctm_${RUN_ID}`,
      currency_code: "USD",
      created_at: "2026-09-01T00:00:00.000000Z",
      updated_at: "2026-09-01T00:00:00.000000Z",
      canceled_at: opts.canceledAt ?? null,
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      current_billing_period:
        opts.status === "canceled"
          ? null
          : { starts_at: "2026-09-01T00:00:00.000000Z", ends_at: opts.periodEndsAt ?? "2026-10-01T00:00:00.000000Z" },
      scheduled_change: opts.scheduledCancel
        ? { action: "cancel", effective_at: opts.periodEndsAt ?? "2026-10-01T00:00:00.000000Z", resume_at: null }
        : null,
      items:
        opts.priceId === null
          ? []
          : [
              {
                status: "active",
                quantity: 1,
                recurring: true,
                created_at: "2026-09-01T00:00:00.000000Z",
                updated_at: "2026-09-01T00:00:00.000000Z",
                price: {
                  id: opts.priceId ?? "pri_growth_test",
                  product_id: "pro_test",
                  description: "test price",
                  tax_mode: "account_setting",
                },
              },
            ],
      // custom_data is an opaque blob Aegis itself sets when opening the
      // checkout overlay (see lib/billing/actions.ts#createCheckoutSessionAction
      // and components/settings/paddle-checkout-provider.tsx) using camelCase
      // keys — Paddle never transforms its contents, so the read side
      // (resolveOrganizationId below) must match that same convention.
      custom_data: opts.orgId ? { organizationId: opts.orgId } : null,
    },
  });
}

type TxnEventOpts = {
  txnId: string;
  orgId?: string;
  subscriptionId?: string;
  customerId?: string;
};

function transactionEventBody(eventType: string, opts: TxnEventOpts): string {
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: `ntf_${RUN_ID}`,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: {
      id: opts.txnId,
      status: eventType === "transaction.completed" ? "completed" : "past_due",
      customer_id: opts.customerId ?? `ctm_${RUN_ID}`,
      subscription_id: opts.subscriptionId ?? null,
      currency_code: "USD",
      origin: "subscription_recurring",
      collection_mode: "automatic",
      created_at: "2026-09-01T00:00:00.000000Z",
      updated_at: "2026-09-01T00:00:00.000000Z",
      items: [],
      payments: [],
      custom_data: opts.orgId ? { organizationId: opts.orgId } : null,
    },
  });
}

function request(body: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["paddle-signature"] = signature;
  return new Request("http://localhost/api/webhooks/paddle", { method: "POST", body, headers });
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.organization.create({ data: { name: "Paddle Webhook Org A", slug: `${RUN_ID}-a` } }),
    prisma.organization.create({ data: { name: "Paddle Webhook Org B", slug: `${RUN_ID}-b` } }),
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

describe("Paddle webhook — signature verification", () => {
  it("rejects a request with no Paddle-Signature header", async () => {
    const body = subscriptionEventBody("subscription.updated", { subId: `sub_${RUN_ID}_sig1`, orgId: orgA });
    const res = await POST(request(body));
    expect(res.status).toBe(400);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const body = subscriptionEventBody("subscription.updated", { subId: `sub_${RUN_ID}_sig2`, orgId: orgA });
    const res = await POST(request(body, sign(body, "wrong_secret")));
    expect(res.status).toBe(400);
  });

  it("accepts a validly-signed event for an unknown org without erroring", async () => {
    const body = subscriptionEventBody("subscription.updated", {
      subId: `sub_${RUN_ID}_orphan`,
      customerId: "ctm_nobody",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);
  });

  it("acknowledges an event type it doesn't act on (200, no handling)", async () => {
    const body = JSON.stringify({
      event_id: nextEventId(),
      event_type: "customer.created",
      occurred_at: new Date().toISOString(),
      data: { id: "ctm_x" },
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);
  });
});

describe("Paddle webhook — subscription lifecycle", () => {
  const subId = `sub_${RUN_ID}_A`;

  it("subscription.created grants the mapped plan and records the subscription", async () => {
    const body = subscriptionEventBody("subscription.created", {
      subId,
      orgId: orgA,
      status: "active",
      priceId: "pri_growth_test",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("growth");
    expect(org.subscriptionStatus).toBe("active");
    expect(org.paddleSubscriptionId).toBe(subId);
    expect(org.cancelAtPeriodEnd).toBe(false);
  });

  it("subscription.updated with a scheduled cancellation keeps the plan but flags cancel-at-period-end", async () => {
    const body = subscriptionEventBody("subscription.updated", {
      subId,
      orgId: orgA,
      status: "active",
      priceId: "pri_growth_test",
      scheduledCancel: true,
      periodEndsAt: "2026-10-01T00:00:00.000000Z",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("growth");
    expect(org.subscriptionStatus).toBe("active");
    expect(org.cancelAtPeriodEnd).toBe(true);
  });

  it("is idempotent — replaying the same event id does not re-apply state", async () => {
    const body = subscriptionEventBody("subscription.updated", {
      subId,
      orgId: orgA,
      status: "active",
      priceId: "pri_growth_test",
      scheduledCancel: true,
    });
    const signed = sign(body);
    expect((await POST(request(body, signed))).status).toBe(200);

    // Tamper with local state, then replay the byte-identical event+signature.
    await prisma.organization.update({ where: { id: orgA }, data: { plan: "free" } });
    expect((await POST(request(body, signed))).status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("free"); // replay was a no-op, not a re-apply
  });

  it("transaction.payment_failed marks past_due but keeps the plan", async () => {
    const body = transactionEventBody("transaction.payment_failed", {
      txnId: `txn_${RUN_ID}_failed`,
      orgId: orgA,
      subscriptionId: subId,
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.subscriptionStatus).toBe("past_due");
  });

  it("transaction.completed recovers past_due back to active", async () => {
    const body = transactionEventBody("transaction.completed", {
      txnId: `txn_${RUN_ID}_completed`,
      orgId: orgA,
      subscriptionId: subId,
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.subscriptionStatus).toBe("active");
  });

  it("subscription.canceled (subscription actually ended) drops the org back to the free plan", async () => {
    const body = subscriptionEventBody("subscription.canceled", {
      subId,
      orgId: orgA,
      status: "canceled",
      canceledAt: "2026-10-01T00:00:00.000000Z",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.plan).toBe("free");
    expect(org.subscriptionStatus).toBe("cancelled");
  });
});

describe("Paddle webhook — tenant isolation", () => {
  it("only touches the org named in verified custom_data, never a bystander", async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });

    const body = subscriptionEventBody("subscription.created", {
      subId: `sub_${RUN_ID}_B`,
      orgId: orgB,
      status: "active",
      priceId: "pri_startup_test",
    });
    expect((await POST(request(body, sign(body)))).status).toBe(200);

    const orgBRow = await prisma.organization.findUniqueOrThrow({ where: { id: orgB } });
    const orgARow = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });

    expect(orgBRow.plan).toBe("startup");
    expect(orgARow.plan).toBe(before.plan); // unchanged
    expect(orgARow.subscriptionStatus).toBe(before.subscriptionStatus);
  });
});
