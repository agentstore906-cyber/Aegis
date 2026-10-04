/** P1 §1/§4/§9 — the API boundary: optional fields, normalization, malformed input. */
import { describe, expect, it } from "vitest";

import { evaluateRequestSchema, eventIngestSchema } from "@/lib/validation/api";

const minimal = { agent: "finance-agent", eventType: "ACTION", action: "invoice.read" };

describe("eventIngestSchema — P1 fields", () => {
  it("accepts an event with none of the new fields (all optional)", () => {
    const parsed = eventIngestSchema.parse(minimal);
    expect(parsed.clientEventId).toBeUndefined();
    expect(parsed.destination).toBeUndefined();
    expect(parsed.dataClasses).toBeUndefined();
  });

  it("normalizes every field at the boundary", () => {
    const parsed = eventIngestSchema.parse({
      ...minimal,
      clientEventId: "evt:2026-10-01:42",
      parentClientEventId: "task-7",
      service: "Stripe API",
      destination: "https://user:pw@API.Stripe.com/v1/charges?key=x",
      dataClasses: ["pii", "Financial"],
      dataSensitivity: "MEDIUM",
      recordCount: 12,
      byteCount: 2048,
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      endUserId: "user_42",
    });
    expect(parsed.service).toBe("stripe-api");
    expect(parsed.destination).toEqual({ destination: "api.stripe.com", kind: "HOST" });
    expect(parsed.dataClasses).toEqual(["PII", "FINANCIAL"]);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
  });

  const malformed: [string, Record<string, unknown>][] = [
    ["an unparseable destination", { destination: "not a host" }],
    ["an unknown data class", { dataClasses: ["SECRET_SAUCE"] }],
    ["too many data classes", { dataClasses: ["PII", "PII", "PII", "PII", "PII", "PII", "PII", "PII"] }],
    ["a negative record count", { recordCount: -1 }],
    ["a fractional record count", { recordCount: 1.5 }],
    ["a byte count over the 32-bit limit", { byteCount: 3_000_000_000 }],
    ["a clientEventId with illegal characters", { clientEventId: "has spaces/and slashes" }],
    ["an over-long clientEventId", { clientEventId: "x".repeat(121) }],
    ["an occurredAt in the future", { occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }],
    ["an occurredAt older than 30 days", { occurredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }],
    ["a non-ISO occurredAt", { occurredAt: "yesterday" }],
    ["both parent references", { parentEventId: "evt_1", parentClientEventId: "task-1" }],
    ["a service with no letters or digits", { service: "!!!" }],
    ["an invalid data sensitivity", { dataSensitivity: "EXTREME" }],
  ];
  for (const [label, extra] of malformed) {
    it(`rejects ${label}`, () => {
      expect(eventIngestSchema.safeParse({ ...minimal, ...extra }).success).toBe(false);
    });
  }
});

describe("evaluateRequestSchema — P1 fields", () => {
  it("accepts the shared context fields and normalizes them", () => {
    const parsed = evaluateRequestSchema.parse({
      agent: "finance-agent",
      action: "crm.export",
      destination: "ops@Partner.example.org",
      dataClasses: ["PII"],
      recordCount: 1200,
    });
    expect(parsed.destination).toEqual({ destination: "partner.example.org", kind: "EMAIL_DOMAIN" });
    expect(parsed.dataClasses).toEqual(["PII"]);
  });

  it("does not accept event-only fields as meaningful (clientEventId/evaluationId are ignored by the schema)", () => {
    const parsed = evaluateRequestSchema.parse({ agent: "a", action: "x.y", clientEventId: "c" }) as Record<string, unknown>;
    expect(parsed.clientEventId).toBeUndefined();
  });
});
