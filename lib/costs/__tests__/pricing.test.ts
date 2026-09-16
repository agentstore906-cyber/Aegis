import { describe, expect, it } from "vitest";
import { resolveEventCost } from "@/lib/costs/pricing";

describe("resolveEventCost", () => {
  it("is CONFIRMED whenever a self-reported cost is present, even $0", () => {
    expect(resolveEventCost({ costCents: 0, modelName: null, inputTokens: null, outputTokens: null })).toEqual({
      basis: "CONFIRMED",
      costCents: 0,
    });
    expect(resolveEventCost({ costCents: 150, modelName: "gpt-4o", inputTokens: 1000, outputTokens: 500 })).toEqual({
      basis: "CONFIRMED",
      costCents: 150,
    });
  });

  it("is ESTIMATED from token counts against a known model's price list", () => {
    const result = resolveEventCost({
      costCents: null,
      modelName: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(result.basis).toBe("ESTIMATED");
    // 15 cents input + 60 cents output per the price table
    expect(result.costCents).toBe(75);
  });

  it("matches a dated model snapshot by prefix (e.g. gpt-4o-2024-08-06)", () => {
    const result = resolveEventCost({
      costCents: null,
      modelName: "gpt-4o-2024-08-06",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(result.basis).toBe("ESTIMATED");
    expect(result.costCents).toBe(250);
  });

  it("is UNKNOWN — never a fabricated number — for an unrecognized model", () => {
    expect(
      resolveEventCost({ costCents: null, modelName: "some-internal-finetune", inputTokens: 1000, outputTokens: 1000 })
    ).toEqual({ basis: "UNKNOWN", costCents: null });
  });

  it("is UNKNOWN when there is no cost, no model, and no tokens at all", () => {
    expect(resolveEventCost({ costCents: null, modelName: null, inputTokens: null, outputTokens: null })).toEqual({
      basis: "UNKNOWN",
      costCents: null,
    });
  });
});
