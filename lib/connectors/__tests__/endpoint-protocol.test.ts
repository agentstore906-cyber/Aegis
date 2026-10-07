import { describe, expect, it } from "vitest";

import {
  PROTOCOL,
  expectedProof,
  manifestDigest,
  newChallenge,
  normalizeEndpointUrl,
  parseAgentResponse,
  parseManifest,
  signRequest,
} from "@/lib/connectors/endpoint-protocol";

const SECRET = "unit-test-shared-secret-0123456789";
const challenge = newChallenge();
const reply = (over: Record<string, unknown> = {}, secret = SECRET, id = "agent-1", op: "verify" | "describe" = "verify", manifest?: unknown) => ({
  protocol: PROTOCOL,
  agent: { id, name: "Support" },
  proof: expectedProof(secret, op, challenge, id, op === "describe" ? manifestDigest(manifest) : ""),
  ...(op === "describe" && manifest ? { manifest } : {}),
  ...over,
});

describe("aegis-agent/1 proof", () => {
  it("accepts an answer that proves the shared secret for THIS challenge, and pins nothing it was not given", () => {
    const r = parseAgentResponse(SECRET, "verify", challenge, reply());
    expect(r).toMatchObject({ ok: true, agent: { id: "agent-1", name: "Support", manifest: null } });
  });

  it("rejects a proof made with another secret, for another challenge, for another op, or for another agent id", () => {
    expect(parseAgentResponse(SECRET, "verify", challenge, reply({}, "some-other-secret-0123456789"))).toMatchObject({ ok: false, code: "BAD_PROOF" });
    expect(parseAgentResponse(SECRET, "verify", newChallenge(), reply())).toMatchObject({ ok: false, code: "BAD_PROOF" });
    expect(parseAgentResponse(SECRET, "describe", challenge, reply())).toMatchObject({ ok: false, code: "BAD_PROOF" });
    // claims a different id than the one the proof was made for
    expect(parseAgentResponse(SECRET, "verify", challenge, reply({ agent: { id: "agent-2", name: "Support" } }))).toMatchObject({ ok: false, code: "BAD_PROOF" });
  });

  it("rejects anything that is not the protocol before reading a single field", () => {
    for (const body of [null, "x", 5, [], {}, { protocol: "other/1" }, { protocol: PROTOCOL }, { protocol: PROTOCOL, agent: { id: "a" } }, { protocol: PROTOCOL, agent: { id: "a", name: "n" } }]) {
      const r = parseAgentResponse(SECRET, "verify", challenge, body);
      expect(r.ok).toBe(false);
    }
  });

  it("the manifest is covered by the proof, so tampering with it fails", () => {
    const manifest = { tools: [{ name: "crm.lookup", access: "read" }] };
    const good = parseAgentResponse(SECRET, "describe", challenge, reply({}, SECRET, "agent-1", "describe", manifest));
    expect(good).toMatchObject({ ok: true, agent: { manifest: { tools: [{ name: "crm.lookup", access: "read" }] } } });
    const tampered = reply({ manifest: { tools: [{ name: "crm.lookup", access: "read" }, { name: "shell.exec", access: "destructive" }] } }, SECRET, "agent-1", "describe", manifest);
    expect(parseAgentResponse(SECRET, "describe", challenge, tampered)).toMatchObject({ ok: false, code: "BAD_PROOF" });
  });

  it("a signature depends on the timestamp and the exact body", () => {
    const a = signRequest(SECRET, "1000", "{}");
    expect(a).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signRequest(SECRET, "1001", "{}")).not.toBe(a);
    expect(signRequest(SECRET, "1000", "{ }")).not.toBe(a);
    expect(signRequest("another-secret-0123456789", "1000", "{}")).not.toBe(a);
  });

  it("challenges are fresh and unguessable", () => {
    expect(new Set(Array.from({ length: 50 }, newChallenge)).size).toBe(50);
    expect(newChallenge().length).toBeGreaterThanOrEqual(40);
  });
});

describe("manifest parsing never trusts shape or size", () => {
  it("keeps only well-formed tools, bounds the list, and treats an undeclared access level as unknown", () => {
    const m = parseManifest({ framework: "x", tools: [{ name: "a", access: "read" }, { name: "b" }, { name: "c", access: "root" }, { nope: 1 }, "str", null, ...Array.from({ length: 300 }, (_, i) => ({ name: `t${i}` }))], humanApproval: "yes" });
    expect(m!.tools.slice(0, 3)).toEqual([{ name: "a", access: "read" }, { name: "b", access: null }, { name: "c", access: null }]);
    expect(m!.tools.length).toBeLessThanOrEqual(100);
    expect(m!.humanApproval).toBeNull();
    expect(parseManifest("nope")).toBeNull();
  });
});

describe("endpoint URL normalization", () => {
  it("normalizes for uniqueness and rejects credentials, queries and non-http schemes", () => {
    expect(normalizeEndpointUrl("HTTPS://Agent.Example.com:443/aegis/#frag")).toMatchObject({ ok: true, normalized: "https://agent.example.com/aegis" });
    expect(normalizeEndpointUrl("https://agent.example.com/Aegis/")).toMatchObject({ ok: true, normalized: "https://agent.example.com/Aegis" });
    for (const bad of ["ftp://x.com/a", "https://u:p@x.com/a", "https://x.com/a?token=1", "javascript:alert(1)", "", "x"]) {
      expect(normalizeEndpointUrl(bad).ok, bad).toBe(false);
    }
  });
});
