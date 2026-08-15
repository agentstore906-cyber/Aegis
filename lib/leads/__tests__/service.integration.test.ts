/**
 * Real dev database, no request context needed — service.ts takes `ip` as a
 * plain argument (resolved from headers() one layer up, in actions.ts) so it
 * can be exercised directly here.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { submitLead } from "@/lib/leads/service";
import { listLeads } from "@/lib/leads/repository";

const RUN_ID = `test_${Date.now()}`;
const validInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Jordan Lee",
  email: `jordan+${RUN_ID}@example.com`,
  company: "Example Co",
  role: "CTO",
  ...overrides,
});

afterEach(async () => {
  await prisma.lead.deleteMany({ where: { email: { contains: RUN_ID } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("submitLead", () => {
  it("creates a lead from valid input", async () => {
    const result = await submitLead(validInput(), "", "1.1.1.1");
    expect(result.ok).toBe(true);

    const leads = await listLeads();
    expect(leads.some((lead) => lead.email === validInput().email)).toBe(true);
  });

  it("rejects invalid input without writing a row", async () => {
    const before = await prisma.lead.count();
    const result = await submitLead(validInput({ email: "not-an-email" }), "", "1.1.1.2");
    expect(result.ok).toBe(false);
    expect(await prisma.lead.count()).toBe(before);
  });

  it("silently discards a submission with a filled honeypot, reporting success", async () => {
    const before = await prisma.lead.count();
    const result = await submitLead(validInput(), "i-am-a-bot", "1.1.1.3");
    expect(result.ok).toBe(true);
    expect(await prisma.lead.count()).toBe(before);
  });

  it("rate-limits repeated submissions from the same IP", async () => {
    const ip = `1.1.1.${Math.floor(Math.random() * 200) + 10}`;
    for (let i = 0; i < 5; i++) {
      const result = await submitLead(validInput({ email: `jordan${i}+${RUN_ID}@example.com` }), "", ip);
      expect(result.ok).toBe(true);
    }
    const sixth = await submitLead(validInput({ email: `jordan5+${RUN_ID}@example.com` }), "", ip);
    expect(sixth.ok).toBe(false);
  });

  it("throttles repeated submissions from the same email within 24h, independent of IP", async () => {
    const email = `throttled+${RUN_ID}@example.com`;
    for (let i = 0; i < 3; i++) {
      const result = await submitLead(validInput({ email }), "", `2.2.2.${i}`);
      expect(result.ok).toBe(true);
    }
    const fourth = await submitLead(validInput({ email }), "", "2.2.2.9");
    expect(fourth.ok).toBe(false);
  });
});
