import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, orgFind, deliveryCreate, postWebhook, tasks } = vi.hoisted(() => ({
  findMany: vi.fn(),
  orgFind: vi.fn(),
  deliveryCreate: vi.fn(),
  postWebhook: vi.fn(),
  tasks: [] as Promise<unknown>[],
}));

vi.mock("@/lib/db", () => ({ prisma: { webhookEndpoint: { findMany }, organization: { findUnique: orgFind }, webhookDelivery: { create: deliveryCreate } } }));
vi.mock("@/lib/server/defer", () => ({ defer: (_label: string, task: () => Promise<unknown>) => void tasks.push(task()) }));
vi.mock("@/lib/webhooks/safe-post", () => ({ postWebhook }));

import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { UnsafeWebhookUrlError } from "@/lib/webhooks/ssrf";

const ENDPOINT = { id: "e1", organizationId: "o1", url: "https://hooks.example/h", secret: "whsec_x" };

async function run() {
  await dispatchWebhookEvent("o1", "approval.requested" as never, { a: 1 });
  await Promise.all(tasks.splice(0));
}

beforeEach(() => {
  vi.useRealTimers();
  findMany.mockReset().mockResolvedValue([ENDPOINT]);
  orgFind.mockReset().mockResolvedValue({ plan: "startup" });
  deliveryCreate.mockReset().mockResolvedValue({});
  postWebhook.mockReset();
});

describe("webhook dispatch uses the pinned, redirect-free sender for every attempt (H2)", () => {
  it("delivers through postWebhook with the signed body and treats 2xx as success (one attempt)", async () => {
    postWebhook.mockResolvedValue({ status: 200 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1);
    const [url, headers, body] = postWebhook.mock.calls[0]!;
    expect(url).toBe(ENDPOINT.url);
    expect(headers["X-Aegis-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(body)).toMatchObject({ event: "approval.requested", data: { a: 1 } });
    expect(deliveryCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCESS", httpStatus: 200 }) }));
  });

  it("a 3xx (redirect) is a failed, NON-retried delivery — it is never followed", async () => {
    postWebhook.mockResolvedValue({ status: 302 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", httpStatus: 302 }) }));
  });

  it("a rejected (internal) destination is logged as FAILED, bounded to 3 attempts, and never throws into the caller", async () => {
    postWebhook.mockRejectedValue(new UnsafeWebhookUrlError("private"));
    await expect(run()).resolves.toBeUndefined();
    expect(postWebhook).toHaveBeenCalledTimes(3);
    expect(deliveryCreate).toHaveBeenCalledTimes(3);
    for (const call of deliveryCreate.mock.calls) expect(call[0].data.status).toBe("FAILED");
  });

  it("a 5xx is retried (bounded) and a 4xx is not", async () => {
    postWebhook.mockResolvedValue({ status: 503 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(3);
    postWebhook.mockReset().mockResolvedValue({ status: 410 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("the source no longer calls global fetch for deliveries", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../dispatch.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

describe("webhook delivery is gated by the organization's CURRENT plan at the delivery boundary (M2)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(["startup", "growth", "business", "enterprise"])("a %s organization delivers", async (plan) => {
    orgFind.mockResolvedValue({ plan });
    postWebhook.mockResolvedValue({ status: 200 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(orgFind).toHaveBeenCalledWith({ where: { id: "o1" }, select: { plan: true } });
  });

  it("REGRESSION: a downgraded (Free) organization with an ACTIVE endpoint makes no outbound request and writes no delivery row", async () => {
    orgFind.mockResolvedValue({ plan: "free" });
    await run();
    expect(postWebhook).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("webhook_delivery_skipped_plan"));
  });

  it.each([["an unrecognized plan string", { plan: "platinum" }], ["an empty plan", { plan: "" }], ["a missing organization", null]])(
    "fails closed for %s",
    async (_label, row) => {
      orgFind.mockResolvedValue(row);
      await run();
      expect(postWebhook).not.toHaveBeenCalled();
    }
  );

  it("fails closed (no delivery, no throw) when the entitlement lookup itself fails", async () => {
    orgFind.mockRejectedValue(Object.assign(new Error("connection string postgres://user:secret@host/db"), { name: "PrismaClientInitializationError" }));
    await expect(run()).resolves.toBeUndefined();
    expect(postWebhook).not.toHaveBeenCalled();
    const logged = error.mock.calls.map((c: unknown[]) => String(c[0])).join("|");
    expect(logged).toContain("webhook_entitlement_check_failed");
    expect(logged).toContain("PrismaClientInitializationError");
    expect(logged).not.toMatch(/secret|postgres:/); // error class only; never the message
  });

  it("REGRESSION: a retry cannot bypass the gate — the plan is re-read before every retry", async () => {
    orgFind.mockResolvedValueOnce({ plan: "startup" }).mockResolvedValueOnce({ plan: "free" }); // dispatch check, then the retry check
    postWebhook.mockResolvedValue({ status: 503 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1); // attempt 1 only; the downgrade stopped attempt 2
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("webhook_retry_skipped_plan"));
  });

  it("a lookup failure between attempts also stops the retry", async () => {
    orgFind.mockResolvedValueOnce({ plan: "startup" }).mockRejectedValueOnce(new Error("blip"));
    postWebhook.mockResolvedValue({ status: 503 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("eligible organizations keep the existing retry behavior (3 bounded attempts, plan re-read before each retry)", async () => {
    postWebhook.mockResolvedValue({ status: 503 });
    await run();
    expect(postWebhook).toHaveBeenCalledTimes(3);
    expect(orgFind).toHaveBeenCalledTimes(3); // 1 dispatch check + 2 retry checks
  });

  it("the skip log never contains the endpoint URL, secret or payload", async () => {
    orgFind.mockResolvedValue({ plan: "free" });
    await run();
    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("|");
    expect(logged).not.toContain(ENDPOINT.url);
    expect(logged).not.toContain(ENDPOINT.secret);
    expect(logged).not.toContain('"a":1');
  });
});
