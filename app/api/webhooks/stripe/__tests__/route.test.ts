/**
 * Integration test against the real dev database. Sets fake (never real)
 * Stripe test-mode-shaped credentials so `stripe.webhooks.constructEvent`
 * can do genuine signature verification — no network call to Stripe is
 * ever made; `constructEvent` and `generateTestHeaderString` are both
 * pure/local crypto operations. This proves signature verification and
 * idempotency actually work; it does NOT prove a real Stripe account's
 * checkout/webhook flow works end to end — that requires real Stripe
 * test-mode credentials this environment doesn't have (see the Phase 6
 * final report).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { prisma } from "@/lib/db";

const RUN_ID = `test_${Date.now()}`;
const WEBHOOK_SECRET = "whsec_test_fake_secret_for_signature_verification_only";

process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_local_signature_verification_only";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

// Imported after env vars are set — the route only reads them inside the
// request handler (lazily, via getStripeClient()), not at module load, so
// import order doesn't actually matter here, but this keeps intent clear.
const { POST } = await import("@/app/api/webhooks/stripe/route");

function signedRequest(payload: object, secretOverride?: string): Request {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: secretOverride ?? WEBHOOK_SECRET,
  });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body,
  });
}

function fakeSubscriptionEvent(id: string, customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_fake",
        object: "subscription",
        customer: customerId,
        status: "active",
        cancel_at_period_end: false,
        items: {
          object: "list",
          data: [{ price: { id: "price_does_not_exist" }, current_period_end: 1_999_999_999 }],
        },
        ...overrides,
      },
    },
  };
}

let org: { id: string; stripeCustomerId: string };

beforeAll(async () => {
  const customerId = `cus_${RUN_ID}`;
  org = await prisma.organization
    .create({
      data: { name: "Stripe Webhook Org", slug: `${RUN_ID}-stripe`, stripeCustomerId: customerId },
    })
    .then((o) => ({ id: o.id, stripeCustomerId: customerId }));
});

afterAll(async () => {
  await prisma.stripeWebhookEvent.deleteMany({ where: { id: { startsWith: `evt_${RUN_ID}` } } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("Stripe webhook signature verification", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const response = await POST(
      signedRequest(fakeSubscriptionEvent(`evt_${RUN_ID}_badsig`, org.stripeCustomerId), "whsec_totally_wrong_secret")
    );
    expect(response.status).toBe(400);
  });

  it("accepts a validly-signed event for an unrecognized customer without erroring", async () => {
    const response = await POST(
      signedRequest(fakeSubscriptionEvent(`evt_${RUN_ID}_unknown`, "cus_does_not_exist_anywhere"))
    );
    expect(response.status).toBe(200);
  });
});

describe("Stripe webhook idempotency", () => {
  it("processes a new event and records it as processed", async () => {
    const eventId = `evt_${RUN_ID}_first`;
    const response = await POST(signedRequest(fakeSubscriptionEvent(eventId, org.stripeCustomerId)));
    expect(response.status).toBe(200);

    const recorded = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });
    expect(recorded).not.toBeNull();

    const updatedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updatedOrg.subscriptionStatus).toBe("active");
  });

  it("replaying the same event id is a safe no-op, not a re-applied change", async () => {
    const eventId = `evt_${RUN_ID}_replay`;
    const first = await POST(signedRequest(fakeSubscriptionEvent(eventId, org.stripeCustomerId)));
    expect(first.status).toBe(200);

    const countAfterFirst = await prisma.stripeWebhookEvent.count({ where: { id: eventId } });
    expect(countAfterFirst).toBe(1);

    // Replay: same event id, could even carry a different payload — must
    // still short-circuit on the id alone rather than re-processing.
    const replay = await POST(signedRequest(fakeSubscriptionEvent(eventId, org.stripeCustomerId, { status: "canceled" })));
    expect(replay.status).toBe(200);

    const countAfterReplay = await prisma.stripeWebhookEvent.count({ where: { id: eventId } });
    expect(countAfterReplay).toBe(1);

    // The replay's differing payload must never have been applied.
    const updatedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updatedOrg.subscriptionStatus).toBe("active");
  });
});
