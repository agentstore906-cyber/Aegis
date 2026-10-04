import { AGENT_TYPES } from "@/lib/scanner/catalog";
import type { RiskLevel, ScanResult, Severity } from "@/lib/scanner/types";

/**
 * The ONLY shape of a scan that is ever exposed on a public page, Open Graph image or share text.
 * It is a projection, so it has no field for anything private: no answers, no evidence text, no
 * custom agent label, no pasted-content signals, no account or agent ids.
 */
export type PublicReport = {
  slug: string;
  score: number;
  level: RiskLevel;
  counts: { high: number; medium: number; low: number; protectedAreas: number };
  /** A generic agent type, never the free-text label. */
  agentTypeLabel: string;
  findings: { title: string; severity: Severity; recommendation: string }[];
  engineVersion: string;
  publishedAt: string;
};

type PublicRow = {
  publicSlug: string | null;
  isPublic: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  agentType: string;
  result: unknown;
};

/** Narrow check on our own stored JSON: a corrupt row must fail closed rather than render garbage. */
export function isScanResult(value: unknown): value is ScanResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.score === "number" && typeof v.level === "string" && Array.isArray(v.findings) && typeof v.counts === "object" && v.counts !== null;
}

export function toPublicReport(row: PublicRow, now: Date = new Date()): PublicReport | null {
  if (!row.isPublic || !row.publicSlug || !row.publishedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  if (!isScanResult(row.result)) return null;
  const result = row.result;
  const type = AGENT_TYPES.find((t) => t.id === row.agentType);
  return {
    slug: row.publicSlug,
    score: Math.max(0, Math.min(100, Math.round(result.score))),
    level: result.level,
    counts: result.counts,
    agentTypeLabel: type && type.id !== "other" ? type.label : "AI agent",
    findings: result.findings.slice(0, 6).map((f) => ({ title: f.title, severity: f.severity, recommendation: f.mitigations[0] ?? "" })),
    engineVersion: result.engineVersion,
    publishedAt: row.publishedAt.toISOString(),
  };
}

export const shareTitle = (score: number) => `My AI Agent Security Score: ${score}/100`;

export function shareText(counts: { high: number }, score: number): string {
  const found = counts.high === 0 ? "no high-risk behaviors" : `${counts.high} high-risk ${counts.high === 1 ? "behavior" : "behaviors"}`;
  return `I scanned my AI agent with Aegis. It found ${found} (risk score ${score}/100).`;
}
