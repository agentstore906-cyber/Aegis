/**
 * Confirmed vs. estimated cost (spec §6): Aegis only ever *knows* a real
 * dollar cost when the caller self-reports one (`costCents` on the
 * ingested event) — Aegis has no billing relationship with any model
 * provider, so it can never confirm spend independently. When a caller
 * reports token counts instead, Aegis can *estimate* a cost from a known
 * public price sheet — but that must always be labeled as an estimate,
 * never presented as fact, and must never be silently summed together
 * with confirmed costs without the UI saying so.
 *
 * This price list is small and deliberately conservative: an unrecognized
 * model returns `null` (UNKNOWN), never a guessed number.
 */

export type CostBasis = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";

/** Cents per 1M tokens. Public list-price snapshots — not a live pricing feed, so treat as approximate. */
const MODEL_PRICE_PER_MILLION_TOKENS_CENTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 250, output: 1000 },
  "gpt-4o-mini": { input: 15, output: 60 },
  "gpt-4-turbo": { input: 1000, output: 3000 },
  "gpt-3.5-turbo": { input: 50, output: 150 },
  "claude-3-5-sonnet": { input: 300, output: 1500 },
  "claude-3-5-haiku": { input: 80, output: 400 },
  "claude-3-opus": { input: 1500, output: 7500 },
  "claude-sonnet-5": { input: 300, output: 1500 },
  "gemini-1.5-pro": { input: 125, output: 500 },
  "gemini-1.5-flash": { input: 7.5, output: 30 },
};

function normalizeModelName(modelName: string): string {
  return modelName.trim().toLowerCase();
}

/** Best-effort match: exact name, then a known key that's a prefix of the reported name (handles dated snapshots like "gpt-4o-2024-08-06"). */
function findPriceEntry(modelName: string) {
  const normalized = normalizeModelName(modelName);
  if (MODEL_PRICE_PER_MILLION_TOKENS_CENTS[normalized]) return MODEL_PRICE_PER_MILLION_TOKENS_CENTS[normalized];
  const prefixMatch = Object.keys(MODEL_PRICE_PER_MILLION_TOKENS_CENTS).find((key) => normalized.startsWith(key));
  return prefixMatch ? MODEL_PRICE_PER_MILLION_TOKENS_CENTS[prefixMatch] : null;
}

export type CostEventLike = {
  costCents: number | null;
  modelName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * The one function that decides confirmed vs. estimated vs. unknown for a
 * single event. Never mutates or persists anything — this is computed at
 * read time so a later addition to the price list retroactively improves
 * historical estimates without a backfill migration.
 */
export function resolveEventCost(event: CostEventLike): { basis: CostBasis; costCents: number | null } {
  if (event.costCents !== null) {
    return { basis: "CONFIRMED", costCents: event.costCents };
  }

  if (event.modelName && (event.inputTokens || event.outputTokens)) {
    const price = findPriceEntry(event.modelName);
    if (price) {
      const inputCost = ((event.inputTokens ?? 0) / 1_000_000) * price.input;
      const outputCost = ((event.outputTokens ?? 0) / 1_000_000) * price.output;
      return { basis: "ESTIMATED", costCents: Math.round(inputCost + outputCost) };
    }
  }

  return { basis: "UNKNOWN", costCents: null };
}
