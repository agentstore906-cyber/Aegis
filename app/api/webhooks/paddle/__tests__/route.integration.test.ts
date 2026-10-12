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
const { PLANS } = await import("@/lib/billing/plans");
const { POST } = await import("@/app/api/webhooks/paddle/route");
const { retentionEligibility } = await import("@/lib/retention/activity");

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
  occurredAt?: string;
};

function subscriptionEventBody(eventType: string, opts: SubEventOpts): string {
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: `ntf_${RUN_ID}`,
    event_type: eventType,
    occurred_at: opts.occurredAt ?? new Date().toISOString(),
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
  occurredAt?: string;
};

function transactionEventBody(eventType: string, opts: TxnEventOpts): string {
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: `ntf_${RUN_ID}`,
    event_type: eventType,
    occurred_at: opts.occurredAt ?? new Date().toISOString(),
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

const extraOrgs: string[] = [];
const eventIdOf = (body: string): string => JSON.parse(body).event_id;
const processedRow = (body: string) => prisma.billingWebhookEvent.findUnique({ where: { id: eventIdOf(body) } });
const send = (body: string) => POST(request(body, sign(body)));
const minutes = (base: number, n: number) => new Date(base + n * 60_000).toISOString();

/** A fresh org with its own Paddle customer id, so events can be matched without custom_data. */
async function newOrg(tag: string, data: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({ data: { name: `Paddle ${tag}`, slug: `${RUN_ID}-${tag}`, paddleCustomerId: `ctm_${RUN_ID}_${tag}`, ...data } });
  extraOrgs.push(org.id);
  return org;
}
const load = (id: string) => prisma.organization.findUniqueOrThrow({ where: { id } });

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
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB, ...extraOrgs] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB, ...extraOrgs] } } });
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

  it("a recent subscription event for an unknown org is NOT acknowledged (500 so Paddle retries) and not recorded", async () => {
    const body = subscriptionEventBody("subscription.updated", {
      subId: `sub_${RUN_ID}_orphan`,
      customerId: "ctm_nobody",
    });
    const res = await POST(request(body, sign(body)));
    expect(res.status).toBe(500);
    expect(await processedRow(body)).toBeNull();
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

const growth = () => PLANS.growth;
const T0 = Date.now() - 60 * 60_000;

describe("Step A — an unmapped price never silently downgrades a paying organization", () => {
  it("a PAID subscription event with an unrecognized price fails (500), changes nothing, and is not recorded; fixing the configuration lets the retry heal it", async () => {
    const org = await newOrg("unmapped");
    const sub = `sub_${RUN_ID}_unmapped`;
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await load(org.id)).plan).toBe("growth");

    const repriced = subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_repriced_unknown", occurredAt: minutes(T0, 1) });
    const signed = sign(repriced);
    const res = await POST(request(repriced, signed));
    expect(res.status).toBe(500);
    const after = await load(org.id);
    expect(after.plan).toBe("growth"); // NOT free
    expect(after.paddlePriceId).toBe("pri_growth_test"); // nothing partially written
    expect(after.planDowngradedAt).toBeNull();
    expect(await processedRow(repriced)).toBeNull();

    // The operator fixes PADDLE_GROWTH_PRICE_ID; Paddle's retry of the same notification now applies.
    const original = growth().paddlePriceId;
    (growth() as { paddlePriceId: string | null }).paddlePriceId = "pri_repriced_unknown";
    try {
      expect((await POST(request(repriced, signed))).status).toBe(200);
    } finally {
      (growth() as { paddlePriceId: string | null }).paddlePriceId = original;
    }
    expect((await load(org.id)).plan).toBe("growth");
    expect(await processedRow(repriced)).not.toBeNull();
  });

  it("a brand-new paying customer on an unrecognized price stays unchanged and the event retries (not silently 'free and paid')", async () => {
    const org = await newOrg("unmapped-new");
    const body = subscriptionEventBody("subscription.created", { subId: `sub_${RUN_ID}_unmapped_new`, orgId: org.id, priceId: "pri_never_configured", occurredAt: minutes(T0, 0) });
    expect((await send(body)).status).toBe(500);
    const after = await load(org.id);
    expect(after).toMatchObject({ plan: "free", subscriptionStatus: null, paddleSubscriptionId: null, billingEventAt: null });
  });

  it("keeps the paid plan for a repriced legacy subscriber whose own stored price is the unrecognized one", async () => {
    const sub = `sub_${RUN_ID}_legacy`;
    const org = await newOrg("legacy", { plan: "growth", paddleSubscriptionId: sub, paddlePriceId: "pri_legacy_price", subscriptionStatus: "active" });
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_legacy_price", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "growth", subscriptionStatus: "active", planDowngradedAt: null });
  });

  it("an ENDED subscription still goes to Free whatever its price", async () => {
    const sub = `sub_${RUN_ID}_ended`;
    const org = await newOrg("ended", { plan: "growth", paddleSubscriptionId: sub, paddlePriceId: "pri_growth_test", subscriptionStatus: "active" });
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", priceId: "pri_whatever", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "free", subscriptionStatus: "cancelled" });
  });
});

describe("Step B — unmatched subscription events", () => {
  it("is retried while recent, and the retry succeeds once the organization can be matched; nothing is recorded in between", async () => {
    const sub = `sub_${RUN_ID}_late_match`;
    const customerId = `ctm_${RUN_ID}_latematch`;
    const body = subscriptionEventBody("subscription.created", { subId: sub, customerId, priceId: "pri_growth_test", occurredAt: new Date().toISOString() });
    const signed = sign(body);
    expect((await POST(request(body, signed))).status).toBe(500);
    expect(await processedRow(body)).toBeNull();

    const org = await prisma.organization.create({ data: { name: "Late", slug: `${RUN_ID}-late`, paddleCustomerId: customerId } });
    extraOrgs.push(org.id);
    expect((await POST(request(body, signed))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "growth", paddleSubscriptionId: sub });
    expect(await processedRow(body)).not.toBeNull();
  });

  it("an old unmatched event is acknowledged (200) but still not recorded, so a manual replay is processed", async () => {
    const sub = `sub_${RUN_ID}_abandoned`;
    const customerId = `ctm_${RUN_ID}_abandoned`;
    const body = subscriptionEventBody("subscription.created", { subId: sub, customerId, priceId: "pri_growth_test", occurredAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() });
    const signed = sign(body);
    expect((await POST(request(body, signed))).status).toBe(200);
    expect(await processedRow(body)).toBeNull();

    const org = await prisma.organization.create({ data: { name: "Abandoned", slug: `${RUN_ID}-abandoned`, paddleCustomerId: customerId } });
    extraOrgs.push(org.id);
    expect((await POST(request(body, signed))).status).toBe(200); // the "replay"
    expect((await load(org.id)).plan).toBe("growth");
    expect(await processedRow(body)).not.toBeNull();
  });

  it("an unmatched event touches no organization (tenant isolation)", async () => {
    const bystander = await newOrg("bystander");
    const body = subscriptionEventBody("subscription.created", { subId: `sub_${RUN_ID}_stranger`, customerId: "ctm_unknown_stranger", priceId: "pri_growth_test", occurredAt: new Date().toISOString() });
    expect((await send(body)).status).toBe(500);
    expect(await load(bystander.id)).toMatchObject({ plan: "free", paddleSubscriptionId: null });
  });

  it("concurrent identical deliveries are idempotent: all succeed, one record, state applied once", async () => {
    const org = await newOrg("dup");
    const body = subscriptionEventBody("subscription.created", { subId: `sub_${RUN_ID}_dup`, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) });
    const signed = sign(body);
    const responses = await Promise.all([POST(request(body, signed)), POST(request(body, signed)), POST(request(body, signed))]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await prisma.billingWebhookEvent.count({ where: { id: eventIdOf(body) } })).toBe(1);
    expect(await load(org.id)).toMatchObject({ plan: "growth", planDowngradedAt: null });
  });
});

describe("Step C — ordering, replaced subscriptions and payment state", () => {
  it("a stale (older) event delivered late is ignored and cannot overwrite newer state", async () => {
    const sub = `sub_${RUN_ID}_order`;
    const org = await newOrg("order");
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 10) }))).status).toBe(200);
    expect((await load(org.id)).plan).toBe("startup");

    // The cancellation that really happened BEFORE the plan change arrives late.
    const late = subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) });
    expect((await send(late)).status).toBe(200);
    const after = await load(org.id);
    expect(after).toMatchObject({ plan: "startup", subscriptionStatus: "active", planDowngradedAt: null });
    expect(after.billingEventAt?.toISOString()).toBe(minutes(T0, 10));
    expect(await processedRow(late)).not.toBeNull(); // definitively obsolete: acknowledged and recorded
  });

  it("concurrent deliveries in either order always end on the newest event", async () => {
    for (let round = 0; round < 6; round++) {
      const sub = `sub_${RUN_ID}_race${round}`;
      const org = await newOrg(`race${round}`);
      const newer = subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 20) });
      const older = subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 15) });
      const calls = round % 2 === 0 ? [newer, older] : [older, newer];
      const statuses = (await Promise.all(calls.map((b) => send(b)))).map((r) => r.status);
      expect(statuses).toEqual([200, 200]);
      const after = await load(org.id);
      expect(after.plan).toBe("startup");
      expect(after.billingEventAt?.toISOString()).toBe(minutes(T0, 20));
    }
  });

  it("ignores update/cancel events for a replaced subscription while accepting the replacement", async () => {
    const subA = `sub_${RUN_ID}_A2`;
    const subB = `sub_${RUN_ID}_B2`;
    const org = await newOrg("replaced");
    expect((await send(subscriptionEventBody("subscription.created", { subId: subA, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.created", { subId: subB, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "startup", paddleSubscriptionId: subB });

    // The old subscription is cancelled AFTER the new one started: that must not downgrade the organization.
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: subA, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 8) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "startup", paddleSubscriptionId: subB, subscriptionStatus: "active", planDowngradedAt: null });
  });

  it("stale transaction events cannot override newer payment state", async () => {
    const sub = `sub_${RUN_ID}_pay`;
    const org = await newOrg("pay");
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);

    // A failure (t=5), a success (t=20), then an OLDER failure (t=10) delivered last.
    expect((await send(transactionEventBody("transaction.payment_failed", { txnId: `txn_${RUN_ID}_p0`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 5) }))).status).toBe(200);
    expect((await load(org.id)).subscriptionStatus).toBe("past_due");
    expect((await send(transactionEventBody("transaction.completed", { txnId: `txn_${RUN_ID}_p2`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 20) }))).status).toBe(200);
    expect((await load(org.id)).subscriptionStatus).toBe("active");
    expect((await send(transactionEventBody("transaction.payment_failed", { txnId: `txn_${RUN_ID}_p1`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 10) }))).status).toBe(200);
    expect((await load(org.id)).subscriptionStatus).toBe("active"); // the older failure was ignored

    // A payment event older than the newest SUBSCRIPTION event is superseded by it too.
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 30) }))).status).toBe(200);
    expect((await send(transactionEventBody("transaction.payment_failed", { txnId: `txn_${RUN_ID}_p3`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 25) }))).status).toBe(200);
    expect((await load(org.id)).subscriptionStatus).toBe("active");
  });
});

describe("Step D — downgrade timestamp lifecycle (the retention grace-period anchor)", () => {
  it("is set once when Aegis applies the downgrade and NOT refreshed by repeated, retried or later free events", async () => {
    const sub = `sub_${RUN_ID}_grace`;
    const org = await newOrg("grace");
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await load(org.id)).planDowngradedAt).toBeNull();

    const cancel = subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 10) });
    expect((await send(cancel)).status).toBe(200);
    const first = (await load(org.id)).planDowngradedAt;
    expect(first).not.toBeNull();
    expect((await load(org.id)).plan).toBe("free");

    // Exact replay (deduped), a second distinct event, and a paused follow-up: the anchor never moves.
    expect((await send(cancel)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 15));
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 11) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, status: "paused", occurredAt: minutes(T0, 12) }))).status).toBe(200);
    expect((await load(org.id)).planDowngradedAt?.getTime()).toBe(first?.getTime());
  });

  it("a delayed, out-of-order 'active' event from before the cancellation cannot undo it or move the anchor", async () => {
    const sub = `sub_${RUN_ID}_grace2`;
    const org = await newOrg("grace2");
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 10) }))).status).toBe(200);
    const anchor = (await load(org.id)).planDowngradedAt;

    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "free", subscriptionStatus: "cancelled" });
    expect((await load(org.id)).planDowngradedAt?.getTime()).toBe(anchor?.getTime());
  });

  it("re-subscribing clears the anchor; a later cancellation starts a new grace period", async () => {
    const org = await newOrg("grace3");
    const subA = `sub_${RUN_ID}_g3a`;
    const subB = `sub_${RUN_ID}_g3b`;
    expect((await send(subscriptionEventBody("subscription.created", { subId: subA, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: subA, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 10) }))).status).toBe(200);
    const first = (await load(org.id)).planDowngradedAt!;
    expect(first).not.toBeNull();

    expect((await send(subscriptionEventBody("subscription.created", { subId: subB, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 20) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "startup", planDowngradedAt: null });

    await new Promise((r) => setTimeout(r, 15));
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: subB, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 30) }))).status).toBe(200);
    const second = (await load(org.id)).planDowngradedAt!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});

describe("Step E — paused / resumed / past_due lifecycle events", () => {
  const T0 = Date.parse("2026-10-01T00:00:00Z");

  it("subscription.paused drops to Free (stamping the downgrade once); subscription.resumed restores the paid plan", async () => {
    const org = await newOrg("pause");
    const sub = `sub_${RUN_ID}_pause`;
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);

    expect((await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 1) }))).status).toBe(200);
    let row = await load(org.id);
    expect(row.plan).toBe("free");
    expect(row.subscriptionStatus).toBe("paused");
    expect(row.planDowngradedAt).not.toBeNull();

    expect((await send(subscriptionEventBody("subscription.resumed", { subId: sub, orgId: org.id, status: "active", priceId: "pri_growth_test", occurredAt: minutes(T0, 2) }))).status).toBe(200);
    row = await load(org.id);
    expect(row.plan).toBe("growth");
    expect(row.subscriptionStatus).toBe("active");
    expect(row.planDowngradedAt).toBeNull();
  });

  it("subscription.past_due keeps the paid plan (dunning window) and records the status", async () => {
    const org = await newOrg("pastdue");
    const sub = `sub_${RUN_ID}_pastdue`;
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    const body = subscriptionEventBody("subscription.past_due", { subId: sub, orgId: org.id, status: "past_due", priceId: "pri_startup_test", occurredAt: minutes(T0, 1) });
    expect((await send(body)).status).toBe(200);
    const row = await load(org.id);
    expect(row.plan).toBe("startup");
    expect(row.subscriptionStatus).toBe("past_due");
    expect((await processedRow(body))?.type).toBe("subscription.past_due");
  });

  it("a late subscription.paused older than a resume is ignored (ordering preserved)", async () => {
    const org = await newOrg("pauseorder");
    const sub = `sub_${RUN_ID}_pauseorder`;
    expect((await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.resumed", { subId: sub, orgId: org.id, status: "active", priceId: "pri_growth_test", occurredAt: minutes(T0, 10) }))).status).toBe(200);
    expect((await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.plan).toBe("growth");
    expect(row.subscriptionStatus).toBe("active");
  });

  it("a paused event for a replaced subscription is ignored", async () => {
    const org = await newOrg("pausereplaced");
    const subA = `sub_${RUN_ID}_prA`;
    const subB = `sub_${RUN_ID}_prB`;
    await send(subscriptionEventBody("subscription.created", { subId: subA, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }));
    await send(subscriptionEventBody("subscription.created", { subId: subB, orgId: org.id, priceId: "pri_startup_test", occurredAt: minutes(T0, 5) }));
    expect((await send(subscriptionEventBody("subscription.paused", { subId: subA, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 8) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.paddleSubscriptionId).toBe(subB);
    expect(row.plan).toBe("startup");
  });

  it("a resumed event for an unmapped paid price fails closed (500, not recorded, plan unchanged)", async () => {
    const org = await newOrg("resumeunmapped");
    const body = subscriptionEventBody("subscription.resumed", { subId: `sub_${RUN_ID}_ru`, orgId: org.id, status: "active", priceId: "pri_unknown_x", occurredAt: minutes(T0, 0) });
    expect((await send(body)).status).toBe(500);
    expect(await processedRow(body)).toBeNull();
    expect((await load(org.id)).plan).toBe("free");
  });

  it("an unmatched lifecycle event is retried (500) rather than silently dropped", async () => {
    const body = subscriptionEventBody("subscription.paused", { subId: `sub_${RUN_ID}_nomatch`, customerId: "ctm_nobody_here", status: "paused", occurredAt: new Date().toISOString() });
    expect((await send(body)).status).toBe(500);
    expect(await processedRow(body)).toBeNull();
  });
});

describe("Step F — pause, cancel and the retention anchor", () => {
  const T0 = Date.parse("2026-10-01T00:00:00Z");

  it("paused -> canceled restamps planDowngradedAt, so an old pause time cannot skip the cancellation grace", async () => {
    const org = await newOrg("pausecancel");
    const sub = `sub_${RUN_ID}_pausecancel`;
    await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }));
    await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 1) }));
    // Pretend the pause started 80 days ago.
    const longAgo = new Date(Date.now() - 80 * 24 * 3600_000);
    await prisma.organization.update({ where: { id: org.id }, data: { planDowngradedAt: longAgo } });

    const before = Date.now();
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect(row.planDowngradedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("resume clears the anchor; a replayed paused-then-resumed sequence does not leave a stale pause time", async () => {
    const org = await newOrg("pauseresume");
    const sub = `sub_${RUN_ID}_pauseresume`;
    await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }));
    await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 1) }));
    expect((await load(org.id)).planDowngradedAt).not.toBeNull();
    await send(subscriptionEventBody("subscription.resumed", { subId: sub, orgId: org.id, status: "active", priceId: "pri_growth_test", occurredAt: minutes(T0, 2) }));
    expect((await load(org.id)).planDowngradedAt).toBeNull();
  });
});

describe("Step G — pause -> failed payment -> end (M1)", () => {
  const T0 = Date.parse("2026-10-01T00:00:00Z");
  const LONG_AGO = () => new Date(Date.now() - 80 * 24 * 3600_000);

  async function pausedThenFailedPayment(tag: string) {
    const org = await newOrg(tag);
    const sub = `sub_${RUN_ID}_${tag}`;
    await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }));
    await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 1) }));
    await prisma.organization.update({ where: { id: org.id }, data: { planDowngradedAt: LONG_AGO() } }); // pause began 80 days ago
    expect((await send(transactionEventBody("transaction.payment_failed", { txnId: `txn_${RUN_ID}_${tag}`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 2) }))).status).toBe(200);
    const flipped = await load(org.id);
    expect(flipped.subscriptionStatus).toBe("past_due"); // the failed payment hid the pause
    expect(flipped.plan).toBe("free");
    return { org, sub };
  }

  it("cancelled after a failed payment while paused still restamps the anchor", async () => {
    const { org, sub } = await pausedThenFailedPayment("m1cancel");
    const before = Date.now();
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect(row.planDowngradedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("expired after a failed payment while paused still restamps the anchor", async () => {
    const { org, sub } = await pausedThenFailedPayment("m1expire");
    const before = Date.now();
    // An unrecognised Paddle status maps to "expired".
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, status: "unknown_ended", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.subscriptionStatus).toBe("expired");
    expect(row.planDowngradedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("a later, differently-identified cancel for the same ended subscription does not restamp it again", async () => {
    const { org, sub } = await pausedThenFailedPayment("m1replay");
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const first = (await load(org.id)).planDowngradedAt!;
    await new Promise((r) => setTimeout(r, 15));
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 6) }))).status).toBe(200);
    expect((await load(org.id)).planDowngradedAt!.getTime()).toBe(first.getTime());
  });

  it("a stale cancel (older than the pause) is ignored: no restamp, status and anchor untouched", async () => {
    const { org, sub } = await pausedThenFailedPayment("m1stale");
    const before = await load(org.id);
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    const after = await load(org.id);
    expect(after.subscriptionStatus).toBe("past_due");
    expect(after.planDowngradedAt!.getTime()).toBe(before.planDowngradedAt!.getTime());
  });

  it("resume after a failed payment while paused restores the plan and clears the anchor", async () => {
    const { org, sub } = await pausedThenFailedPayment("m1resume");
    expect((await send(subscriptionEventBody("subscription.resumed", { subId: sub, orgId: org.id, status: "active", priceId: "pri_growth_test", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row).toMatchObject({ plan: "growth", subscriptionStatus: "active", planDowngradedAt: null });
  });
});

describe("Step H — legacy paused organization (no stamp) -> failed payment -> end (F1)", () => {
  const T0 = Date.parse("2026-10-01T00:00:00Z");
  const DAY = 24 * 3600_000;

  async function legacyPausedThenFailedPayment(tag: string) {
    const org = await newOrg(tag);
    const sub = `sub_${RUN_ID}_${tag}`;
    await send(subscriptionEventBody("subscription.created", { subId: sub, orgId: org.id, priceId: "pri_growth_test", occurredAt: minutes(T0, 0) }));
    await send(subscriptionEventBody("subscription.paused", { subId: sub, orgId: org.id, status: "paused", priceId: "pri_growth_test", occurredAt: minutes(T0, 1) }));
    await prisma.organization.update({ where: { id: org.id }, data: { planDowngradedAt: null } }); // paused before the column existed
    expect(retentionEligibility(await load(org.id), new Date())).toEqual({ eligible: false, reason: "paused_no_anchor" });

    expect((await send(transactionEventBody("transaction.payment_failed", { txnId: `txn_${RUN_ID}_${tag}`, orgId: org.id, subscriptionId: sub, occurredAt: minutes(T0, 2) }))).status).toBe(200);
    const flipped = await load(org.id);
    expect(flipped).toMatchObject({ plan: "free", subscriptionStatus: "past_due", planDowngradedAt: null });
    expect(retentionEligibility(flipped, new Date())).toEqual({ eligible: false, reason: "billing_anomaly" }); // still protected
    return { org, sub };
  }

  it("cancelled: gets a stamp, so protection continues as the 14-day cancellation grace, then normal Free retention", async () => {
    const { org, sub } = await legacyPausedThenFailedPayment("f1cancel");
    const before = Date.now();
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect(row.planDowngradedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(retentionEligibility(row, new Date())).toEqual({ eligible: false, reason: "downgrade_grace" });
    expect(retentionEligibility(row, new Date(row.planDowngradedAt!.getTime() + 14 * DAY))).toEqual({ eligible: true });
  });

  it("expired: same outcome", async () => {
    const { org, sub } = await legacyPausedThenFailedPayment("f1expire");
    expect((await send(subscriptionEventBody("subscription.updated", { subId: sub, orgId: org.id, status: "unknown_ended", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row.subscriptionStatus).toBe("expired");
    expect(row.planDowngradedAt).not.toBeNull();
    expect(retentionEligibility(row, new Date())).toEqual({ eligible: false, reason: "downgrade_grace" });
  });

  it("a replayed cancel (new event id, later time) does not restamp", async () => {
    const { org, sub } = await legacyPausedThenFailedPayment("f1replay");
    await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 5) }));
    const first = (await load(org.id)).planDowngradedAt!;
    await new Promise((r) => setTimeout(r, 15));
    await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 6) }));
    expect((await load(org.id)).planDowngradedAt!.getTime()).toBe(first.getTime());
  });

  it("a stale cancel (older than the pause) changes nothing: still past_due, still no stamp, still protected", async () => {
    const { org, sub } = await legacyPausedThenFailedPayment("f1stale");
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: sub, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row).toMatchObject({ subscriptionStatus: "past_due", planDowngradedAt: null });
    expect(retentionEligibility(row, new Date())).toEqual({ eligible: false, reason: "billing_anomaly" });
  });

  it("resume restores the plan and leaves no stamp (there was none)", async () => {
    const { org, sub } = await legacyPausedThenFailedPayment("f1resume");
    expect((await send(subscriptionEventBody("subscription.resumed", { subId: sub, orgId: org.id, status: "active", priceId: "pri_growth_test", occurredAt: minutes(T0, 5) }))).status).toBe(200);
    expect(await load(org.id)).toMatchObject({ plan: "growth", subscriptionStatus: "active", planDowngradedAt: null });
  });

  it("an organization that never had a subscription is not given a stamp when its first event is an end", async () => {
    const org = await newOrg("f1never");
    expect((await send(subscriptionEventBody("subscription.canceled", { subId: `sub_${RUN_ID}_f1never`, orgId: org.id, status: "canceled", occurredAt: minutes(T0, 0) }))).status).toBe(200);
    const row = await load(org.id);
    expect(row).toMatchObject({ plan: "free", subscriptionStatus: "cancelled", planDowngradedAt: null });
    expect(retentionEligibility(row, new Date())).toEqual({ eligible: true }); // always-Free semantics preserved
  });
});
