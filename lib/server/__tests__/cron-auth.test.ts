import { afterEach, describe, expect, it } from "vitest";

import { isAuthorizedCron, rejectUnauthorizedCron } from "@/lib/server/cron-auth";

const original = process.env.CRON_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

const req = (authorization?: string) => new Request("http://localhost/api/internal/retention/purge", { headers: authorization ? { authorization } : {} });

describe("internal cron gate (retention purge + behavior refresh)", () => {
  it("fails closed with 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = rejectUnauthorizedCron(req("Bearer anything"));
    expect(res?.status).toBe(503);
  });

  it("rejects a missing or wrong bearer with 401 and never runs the job", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(rejectUnauthorizedCron(req())?.status).toBe(401);
    expect(rejectUnauthorizedCron(req("Bearer wrong-value!"))?.status).toBe(401);
    expect(rejectUnauthorizedCron(req("s3cret-value"))?.status).toBe(401);
  });

  it("lets the exact bearer through", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(rejectUnauthorizedCron(req("Bearer s3cret-value"))).toBeNull();
    expect(isAuthorizedCron("Bearer s3cret-value", "s3cret-value")).toBe(true);
  });
});
