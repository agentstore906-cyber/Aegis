import {
  ARENA_CATEGORIES,
  ARENA_CATEGORY_LABELS,
  type ArenaCategory,
  type CategoryScores,
} from "@/lib/arena/types";

/**
 * The ONLY shape of a scorecard that is ever exposed on a public page, in
 * Open Graph metadata, or in a share card. Everything identifying —
 * organization, agent name/slug/id, model, permissions, policies,
 * activity, resources, internal IDs — is left behind by construction: this
 * type simply has no field for it.
 */
export type PublicScorecard = {
  publicSlug: string;
  displayName: string;
  overallScore: number;
  categoryScores: CategoryScores;
  benchmarkVersion: string;
  publishedAt: string;
};

export const DEFAULT_DISPLAY_NAME = "Anonymous Agent";

type ScorecardRow = {
  publicSlug: string | null;
  displayName: string | null;
  overallScore: number | null;
  categoryScores: unknown;
  benchmarkVersion: string;
  publishedAt: Date | null;
  isPublic: boolean;
};

export function parseCategoryScores(value: unknown): CategoryScores {
  return coerceCategoryScores(value);
}

function coerceCategoryScores(value: unknown): CategoryScores {
  const record = (value ?? {}) as Record<string, unknown>;
  const out = {} as CategoryScores;
  for (const category of ARENA_CATEGORIES) {
    const n = record[category];
    out[category] = typeof n === "number" && Number.isFinite(n) ? clampInt(n) : 0;
  }
  return out;
}

function clampInt(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Returns null unless the row is genuinely public and complete. */
export function toPublicScorecard(row: ScorecardRow): PublicScorecard | null {
  if (!row.isPublic || !row.publicSlug || row.overallScore === null || !row.publishedAt) {
    return null;
  }
  return {
    publicSlug: row.publicSlug,
    displayName: sanitizeDisplayName(row.displayName),
    overallScore: Math.max(0, Math.min(1000, Math.round(row.overallScore))),
    categoryScores: coerceCategoryScores(row.categoryScores),
    benchmarkVersion: row.benchmarkVersion,
    publishedAt: row.publishedAt.toISOString(),
  };
}

/**
 * A user-supplied display name is the one free-text field on a public card.
 * Strip anything that could smuggle in identifying detail or markup, cap
 * length, and fall back to the anonymous label.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_DISPLAY_NAME;
  const cleaned = raw
    .replace(/[<>{}[\]\\/@]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned.length >= 2 ? cleaned : DEFAULT_DISPLAY_NAME;
}

export function topCategories(
  scores: CategoryScores,
  count = 3
): { category: ArenaCategory; label: string; score: number }[] {
  return [...ARENA_CATEGORIES]
    .map((category) => ({ category, label: ARENA_CATEGORY_LABELS[category], score: scores[category] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

export function shareCardText(card: PublicScorecard): string {
  return `My Agent scored ${card.overallScore}/1000 in the Aegis Agent Arena. Can your Agent beat it?`;
}

export function challengePrompt(overallScore: number): string {
  return `Can your Agent beat ${overallScore}?`;
}
