import { beforeEach, describe, expect, it, vi } from "vitest";

const { countLeadsCreatedSince, createLead } = vi.hoisted(() => ({ countLeadsCreatedSince: vi.fn(), createLead: vi.fn() }));
vi.mock("@/lib/leads/repository", () => ({ countLeadsCreatedSince, createLead }));

import { submitLead } from "@/lib/leads/service";

let n = 0;
const lead = (email: string) => ({ name: "Pat", email, company: "Acme", role: "Engineer", source: "CONTACT" });

beforeEach(() => {
  countLeadsCreatedSince.mockReset().mockResolvedValue(0);
  createLead.mockReset().mockImplementation(async () => ({ id: "lead-1" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  n += 1;
});

describe("lead form rate limiting", () => {
  it("trusted IP: 5 submissions per hour per client, the 6th is refused, another client is unaffected", async () => {
    const ip = `198.51.100.${n}`;
    for (let i = 0; i < 5; i += 1) expect((await submitLead(lead(`p${n}-${i}@example.com`), "", ip)).ok).toBe(true);
    const sixth = await submitLead(lead(`p${n}-6@example.com`), "", ip);
    expect(sixth).toEqual({ ok: false, error: expect.stringMatching(/Too many submissions/) });
    expect((await submitLead(lead(`q${n}@example.com`), "", `203.0.113.${n}`)).ok).toBe(true);
  });

  it("REGRESSION: with no trustworthy IP, prospects are not blocked by a shared bucket", async () => {
    for (let i = 0; i < 40; i += 1) expect((await submitLead(lead(`prospect${n}-${i}@example.com`), "", "unknown")).ok).toBe(true);
  });

  it("with no trustworthy IP the per-email cap (database, 3 per 24 h) still applies", async () => {
    countLeadsCreatedSince.mockResolvedValue(3);
    expect(await submitLead(lead(`repeat${n}@example.com`), "", "unknown")).toEqual({ ok: false, error: expect.stringMatching(/recent request from this email/) });
    expect(createLead).not.toHaveBeenCalled();
  });

  it("the honeypot and validation still run first and are unaffected", async () => {
    expect(await submitLead(lead("bot@example.com"), "filled", "unknown")).toEqual({ ok: true, id: "discarded" });
    expect((await submitLead(lead("bad"), "", "unknown")).ok).toBe(false);
    expect(createLead).not.toHaveBeenCalled();
  });
});
