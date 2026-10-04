import { describe, expect, it } from "vitest";

import { WITHHELD, isReasoningKey, sanitizeContext } from "@/lib/graph/sanitize";

describe("isReasoningKey", () => {
  it.each(["reasoning", "Reasoning", "thought", "thoughts", "agent_thoughts", "agentThoughts", "chain_of_thought", "chainOfThought", "chain-of-thought", "cot", "scratchpad", "internalMonologue", "rationale", "thinking", "reflection"])(
    "withholds %s",
    (key) => expect(isReasoningKey(key)).toBe(true)
  );

  it.each(["failure_reason", "reasonCode", "reason", "amount", "customerId", "threshold", "action", "cotton", "tool", "destination"])(
    "keeps %s",
    (key) => expect(isReasoningKey(key)).toBe(false)
  );
});

describe("sanitizeContext", () => {
  it("passes null/undefined/primitives through and reports nothing withheld", () => {
    expect(sanitizeContext(null)).toEqual({ value: null, withheld: false });
    expect(sanitizeContext(undefined)).toEqual({ value: null, withheld: false });
    expect(sanitizeContext(5)).toEqual({ value: 5, withheld: false });
  });

  it("withholds at any depth, including inside arrays", () => {
    const out = sanitizeContext({ steps: [{ thinking: "secret plan", n: 1 }], a: { b: { scratchpad: "x" } } });
    expect(out.withheld).toBe(true);
    expect(out.value).toEqual({ steps: [{ thinking: WITHHELD, n: 1 }], a: { b: { scratchpad: WITHHELD } } });
  });

  it("bounds string length, key count, array length and depth", () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) big[`k${i}`] = i;
    const out = sanitizeContext({ long: "y".repeat(2000), big, list: Array.from({ length: 50 }, (_, i) => i), deep: { a: { b: { c: { d: { e: 1 } } } } } }).value as Record<string, unknown>;
    expect((out.long as string).length).toBe(501);
    expect(Object.keys(out.big as object)).toHaveLength(41);
    expect((out.list as unknown[]).length).toBe(21);
    expect(JSON.stringify(out.deep)).toContain("[truncated]");
  });

  it("does not mutate its input", () => {
    const input = { reasoning: "keep me", nested: { a: 1 } };
    sanitizeContext(input);
    expect(input).toEqual({ reasoning: "keep me", nested: { a: 1 } });
  });
});
