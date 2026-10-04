import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: () => ({
        findFirst: () => new Promise(() => {}),
        findMany: () => new Promise(() => {}),
        count: () => new Promise(() => {}),
      }),
    }
  ),
}));

import { startRiskContext } from "@/lib/risk/context";

const req = {
  organizationId: "org",
  agentId: "agent",
  action: "a",
  eventType: "ACTION",
  toolKey: null,
  service: null,
  destination: null,
  dataClasses: [],
  endUserHash: null,
  recordCount: null,
  byteCount: null,
  parentEventId: null,
  now: new Date(),
};

describe("startRiskContext", () => {
  it("resolves to null (never hangs, never rejects) when the evidence queries are too slow", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(startRiskContext(req, 20)).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("risk_context_timeout"));
    spy.mockRestore();
  });
});
