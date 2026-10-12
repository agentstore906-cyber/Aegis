import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";
import { consumeAgentScan, readScanLimit, type AgentScanLimiters } from "@/lib/scanner/agent-scan-rate-limit";

const HOUR = 60 * 60 * 1000;
const limiters = (agent: number, org: number): AgentScanLimiters => ({
  perAgent: new InMemoryRateLimiter(agent, HOUR),
  perOrganization: new InMemoryRateLimiter(org, HOUR),
});

describe("Free Risk Scanner rate limit", () => {
  it("lets a Free workspace scan each of its 3 agents several times", async () => {
    const l = limiters(10, 30);
    for (let round = 0; round < 3; round++) {
      for (const slug of ["a", "b", "c"]) expect(await consumeAgentScan("org1", slug, l)).toEqual({ allowed: true });
    }
  });

  it("stops one agent being hammered, without blocking the workspace's other agents", async () => {
    const l = limiters(3, 30);
    for (let i = 0; i < 3; i++) expect((await consumeAgentScan("org1", "busy", l)).allowed).toBe(true);
    const blocked = await consumeAgentScan("org1", "busy", l);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.message).toMatch(/scanned several times.*Try again in \d+ minutes?/);
    expect((await consumeAgentScan("org1", "other", l)).allowed).toBe(true);
  });

  it("caps the whole workspace, and one workspace never spends another's budget", async () => {
    const l = limiters(10, 2);
    expect((await consumeAgentScan("org1", "a", l)).allowed).toBe(true);
    expect((await consumeAgentScan("org1", "b", l)).allowed).toBe(true);
    const blocked = await consumeAgentScan("org1", "c", l);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.message).toMatch(/workspace has run a lot of scans/);
    expect((await consumeAgentScan("org2", "a", l)).allowed).toBe(true);
  });

  it("keys the per-agent budget by organization, so equal slugs in two workspaces are independent", async () => {
    const l = limiters(1, 30);
    expect((await consumeAgentScan("org1", "same", l)).allowed).toBe(true);
    expect((await consumeAgentScan("org2", "same", l)).allowed).toBe(true);
    expect((await consumeAgentScan("org1", "same", l)).allowed).toBe(false);
  });
});

describe("readScanLimit (env override)", () => {
  it("accepts a positive integer", () => expect(readScanLimit("25", 10)).toBe(25));
  it.each([undefined, "", "0", "-3", "2.5", "abc"])("falls back to the default for %j", (raw) => expect(readScanLimit(raw, 10)).toBe(10));
});
