import { describe, expect, it } from "vitest";

import { LIMITS } from "@/lib/scanner/catalog";
import { analyzePastedText, normalizeText } from "@/lib/scanner/pasted";
import { parseScanRequest, sanitizeLabel } from "@/lib/scanner/validation";
import { runRiskEngine } from "@/lib/scanner/engine";
import { sanitizeProps } from "@/lib/scanner/analytics";

const valid = () => ({ agentType: "coding", capabilities: ["shell"], autonomy: ["autonomous"], controls: { sandboxing: "in_place" } });

describe("request validation", () => {
  it("accepts a well-formed request and normalises it", () => {
    const r = parseScanRequest({ ...valid(), capabilities: ["shell", "shell", "apis"], advancedText: "  hello  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.capabilities).toEqual(["shell", "apis"]); // de-duplicated
      expect(r.input.advancedText).toBe("hello");
      expect(r.input.agentLabel).toBeNull();
    }
  });

  it.each([
    ["not an object", "hello"],
    ["array", []],
    ["null", null],
    ["missing agentType", { capabilities: [], autonomy: ["suggest"] }],
    ["unknown agentType", { ...valid(), agentType: "rm -rf /" }],
    ["unknown capability", { ...valid(), capabilities: ["shell", "launch_missiles"] }],
    ["capabilities not an array", { ...valid(), capabilities: "shell" }],
    ["no autonomy", { ...valid(), autonomy: [] }],
    ["unknown autonomy", { ...valid(), autonomy: ["god_mode"] }],
    ["unknown control key", { ...valid(), controls: { firewall: "in_place" } }],
    ["unknown control state", { ...valid(), controls: { sandboxing: "definitely" } }],
    ["extra top-level field", { ...valid(), isAdmin: true }],
    ["wrong type for text", { ...valid(), advancedText: 12345 }],
  ])("rejects %s with field errors", (_name, body) => {
    const r = parseScanRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).length).toBeGreaterThan(0);
  });

  it("does not let a __proto__ key pollute prototypes or reach the validated input", () => {
    const body = JSON.parse('{"agentType":"coding","capabilities":[],"autonomy":["suggest"],"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}');
    const r = parseScanRequest(body);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    if (r.ok) expect(Object.keys(r.input)).toEqual(["agentType", "agentLabel", "capabilities", "autonomy", "controls", "advancedText"]);
  });

  it("rejects 'read only' combined with other levels", () => {
    const r = parseScanRequest({ ...valid(), autonomy: ["read_only", "autonomous"] });
    expect(r.ok).toBe(false);
  });

  it("rejects oversized pasted content instead of silently truncating it", () => {
    const r = parseScanRequest({ ...valid(), advancedText: "a".repeat(LIMITS.maxAdvancedChars + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.advancedText).toMatch(/characters or fewer/);
    expect(parseScanRequest({ ...valid(), advancedText: "a".repeat(LIMITS.maxAdvancedChars) }).ok).toBe(true);
  });

  it("never reflects submitted values in error messages", () => {
    const payload = "<script>alert('xss-reflect-canary')</script>";
    const r = parseScanRequest({ ...valid(), agentType: payload, autonomy: [payload], controls: { [payload]: "in_place" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).not.toContain("xss-reflect-canary");
  });
});

describe("free-text label sanitisation (XSS and markup)", () => {
  it.each([
    ["<script>alert(1)</script>", /<|>/],
    ['"><img src=x onerror=alert(1)>', /<|>/],
    ["javascript:alert(1) {{7*7}} ${process.env.SECRET}", /[{}$]/],
    ["see https://evil.example/phish now", /https?:/],
  ])("strips markup and links from %j", (raw, forbidden) => {
    const out = sanitizeLabel(raw);
    expect(out).not.toMatch(forbidden);
    expect(out.length).toBeLessThanOrEqual(LIMITS.maxAgentLabelChars);
  });

  it("removes invisible and bidi-override characters and caps the length", () => {
    const out = sanitizeLabel("Pro​cure‮ment" + "x".repeat(500));
    expect(out).not.toMatch(/[​‮]/);
    expect(out.length).toBeLessThanOrEqual(LIMITS.maxAgentLabelChars);
  });

  it("only keeps a label for agent type 'other'", () => {
    const r = parseScanRequest({ ...valid(), agentLabel: "My bot" });
    expect(r.ok && r.input.agentLabel).toBeNull();
    const o = parseScanRequest({ ...valid(), agentType: "other", agentLabel: "<b>My</b> bot" });
    expect(o.ok && o.input.agentLabel).toBeTruthy();
    expect(o.ok && o.input.agentLabel).not.toMatch(/[<>]/);
  });
});

describe("pasted content handling", () => {
  it("normalises hidden characters before analysis", () => {
    expect(normalizeText("s​k\u0000-abc", 100)).toBe("sk-abc");
  });

  it("detects secrets hidden with zero-width characters", () => {
    const sneaky = "sk-​live-abcdefghijklmnopqrstuvwxyz0123456789";
    const r = analyzePastedText(`key=${sneaky}`, 10_000);
    expect(r.signals.some((s) => s.id.startsWith("secret_"))).toBe(true);
  });

  it("returns only ids, labels and counts — never the pasted text", () => {
    const canary = "CANARY_PRIVATE_PROMPT_9f3a";
    const r = analyzePastedText(`You are Acme's internal bot ${canary}. Use bash and curl. sk-abcdefghijklmnopqrstuvwxyz012345`, 10_000);
    const json = JSON.stringify(r);
    expect(json).not.toContain(canary);
    expect(json).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(r.signals.every((s) => /^[a-z_]+$/.test(s.id) && Number.isInteger(s.count) && s.count <= 99)).toBe(true);
  });

  it("treats XSS and template payloads as inert text", () => {
    const r = analyzePastedText('<script>fetch("//evil")</script> {{constructor.constructor("return process")()}} ${jndi:ldap://x}', 10_000);
    const result = runRiskEngine(
      { agentType: "workflow", agentLabel: null, capabilities: [], autonomy: ["suggest"], controls: {}, advancedText: null },
      r
    );
    const out = JSON.stringify(result);
    expect(out).not.toMatch(/<script|jndi|constructor/);
  });

  it("stays fast on adversarial input (no catastrophic regex backtracking)", () => {
    const attacks = [
      "a".repeat(10_000),
      "password=".repeat(1_100),
      "select " + " ".repeat(9_000) + "x",
      "ignore " + "previous ".repeat(1_000),
      "://".repeat(3_000),
      "-----BEGIN ".repeat(900),
      "AKIA".repeat(2_500),
    ];
    for (const attack of attacks) {
      const start = performance.now();
      analyzePastedText(attack, 10_000);
      expect(performance.now() - start).toBeLessThan(500);
    }
  });

  it("caps counts so a repetitive payload cannot inflate stored data", () => {
    const r = analyzePastedText("bash ".repeat(5_000), 10_000);
    expect(Math.max(...r.signals.map((s) => s.count))).toBeLessThanOrEqual(99);
  });
});

describe("analytics property sanitisation", () => {
  it("keeps only allowlisted keys with safe scalar values", () => {
    const out = sanitizeProps({ step: 3, level: "high", channel: "x", prompt: "my secret prompt", email: "a@b.c", source: "has spaces and <b>", score: 72.9, highRisk: true, nested: { a: 1 } });
    expect(out).toEqual({ step: 3, level: "high", channel: "x", score: 72, highRisk: true });
  });

  it("returns undefined for non-objects and empty results", () => {
    expect(sanitizeProps(null)).toBeUndefined();
    expect(sanitizeProps("x")).toBeUndefined();
    expect(sanitizeProps([1])).toBeUndefined();
    expect(sanitizeProps({ unknown: 1 })).toBeUndefined();
  });
});
