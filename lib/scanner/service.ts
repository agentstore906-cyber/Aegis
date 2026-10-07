import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/scanner/catalog";
import { runRiskEngine } from "@/lib/scanner/engine";
import { analyzePastedText } from "@/lib/scanner/pasted";
import { isScanResult, toPublicReport, type PublicReport } from "@/lib/scanner/share";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import type { RiskLevel, ScanInput, ScanResult } from "@/lib/scanner/types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ANONYMOUS_SCAN_TTL_MS = 30 * DAY_MS;
export const PUBLISHED_SCAN_TTL_MS = 90 * DAY_MS;

export type ScanRecord = {
  id: string;
  createdAt: Date;
  agentType: string;
  agentLabel: string | null;
  userId: string | null;
  organizationId: string | null;
  connectedAgentId: string | null;
  isPublic: boolean;
  publicSlug: string | null;
  expiresAt: Date | null;
  claimedAt: Date | null;
  result: ScanResult;
};

/** Who is asking. Anonymous ownership is the session; claimed scans belong to the user/organization. */
export type Viewer = { sessionHash?: string | null; userId?: string | null; organizationIds?: string[] };

export const newScanId = () => randomBytes(16).toString("base64url");
const newPublicSlug = () => randomBytes(9).toString("base64url");
const SCAN_ID_SHAPE = /^[A-Za-z0-9_-]{22}$/;
const SLUG_SHAPE = /^[A-Za-z0-9_-]{12}$/;
export const isScanId = (value: string) => SCAN_ID_SHAPE.test(value);

type Row = NonNullable<Awaited<ReturnType<typeof prisma.riskScan.findUnique>>>;

function toRecord(row: Row): ScanRecord | null {
  if (!isScanResult(row.result)) return null; // a corrupt row fails closed
  return {
    id: row.id,
    createdAt: row.createdAt,
    agentType: row.agentType,
    agentLabel: row.agentLabel,
    userId: row.userId,
    organizationId: row.organizationId,
    connectedAgentId: row.connectedAgentId,
    isPublic: row.isPublic,
    publicSlug: row.publicSlug,
    expiresAt: row.expiresAt,
    claimedAt: row.claimedAt,
    result: row.result,
  };
}

/** Pure ownership decision, exported for tests. A claimed scan is never reachable by a bare session. */
export function canView(row: { sessionHash: string | null; userId: string | null; organizationId: string | null }, viewer: Viewer): boolean {
  if (row.userId) {
    return (viewer.userId != null && viewer.userId === row.userId) || (row.organizationId != null && (viewer.organizationIds ?? []).includes(row.organizationId));
  }
  return Boolean(row.sessionHash && viewer.sessionHash && row.sessionHash === viewer.sessionHash);
}

/** Runs the pipeline: validated input → (in-memory) pasted-text signals → deterministic engine → stored result. */
export async function createScan(params: { input: ScanInput; sessionHash: string | null; userId?: string | null; organizationId?: string | null }) {
  const { input } = params;
  const pasted = input.advancedText ? analyzePastedText(input.advancedText, LIMITS.maxAdvancedChars) : null;
  const result = runRiskEngine(input, pasted);
  const owned = Boolean(params.userId);
  const id = newScanId();

  await prisma.riskScan.create({
    data: {
      id,
      sessionHash: params.sessionHash,
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      agentType: input.agentType,
      agentLabel: input.agentLabel,
      capabilities: input.capabilities,
      autonomy: input.autonomy,
      controls: input.controls,
      // Signals only: ids, labels, counts. The pasted text itself is dropped here and never persisted.
      inputSignals: pasted ? { chars: pasted.chars, signals: pasted.signals } : undefined,
      engineVersion: result.engineVersion,
      score: result.score,
      level: result.level,
      highRiskCount: result.counts.high,
      mediumCount: result.counts.medium,
      result: JSON.parse(JSON.stringify(result)),
      claimedAt: owned ? new Date() : null,
      expiresAt: owned ? null : new Date(Date.now() + ANONYMOUS_SCAN_TTL_MS),
    },
  });

  // Retention: opportunistically purge expired anonymous scans (no scheduler needed; same pattern as the rate limiter).
  if (Math.random() < 0.02) {
    prisma.riskScan.deleteMany({ where: { expiresAt: { lt: new Date() }, userId: null } }).catch(() => {});
  }

  return { id, result };
}

export type ScanLookup = { status: "ok"; scan: ScanRecord } | { status: "not_found" } | { status: "expired" };

/** Distinguishes "expired" from "never existed or not yours" so the UI can say the right thing without leaking existence. */
export async function getScanForViewer(id: string, viewer: Viewer): Promise<ScanLookup> {
  if (!isScanId(id)) return { status: "not_found" };
  const row = await prisma.riskScan.findUnique({ where: { id } });
  if (!row || !canView(row, viewer)) return { status: "not_found" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  const scan = toRecord(row);
  return scan ? { status: "ok", scan } : { status: "not_found" };
}

export async function getPublicReportBySlug(slug: string): Promise<PublicReport | null> {
  if (!SLUG_SHAPE.test(slug)) return null;
  const row = await prisma.riskScan.findUnique({ where: { publicSlug: slug } });
  return row ? toPublicReport(row) : null;
}

/** Publishing is explicit and reversible. Unpublishing drops the slug so an old link can never come back to life. */
export async function setScanPublic(id: string, viewer: Viewer, makePublic: boolean): Promise<{ ok: true; slug: string | null } | { ok: false }> {
  if (!isScanId(id)) return { ok: false };
  const row = await prisma.riskScan.findUnique({ where: { id } });
  if (!row || !canView(row, viewer) || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return { ok: false };

  if (!makePublic) {
    await prisma.riskScan.update({
      where: { id },
      data: { isPublic: false, publicSlug: null, publishedAt: null, expiresAt: row.userId ? null : new Date(Date.now() + ANONYMOUS_SCAN_TTL_MS) },
    });
    return { ok: true, slug: null };
  }
  if (row.isPublic && row.publicSlug) return { ok: true, slug: row.publicSlug };

  const slug = newPublicSlug();
  await prisma.riskScan.update({
    where: { id },
    data: { isPublic: true, publicSlug: slug, publishedAt: new Date(), expiresAt: row.userId ? null : new Date(Date.now() + PUBLISHED_SCAN_TTL_MS) },
  });
  return { ok: true, slug };
}

/**
 * Attaches anonymous scans made in this browser to the account that just signed in. Idempotent;
 * only scans that are still unclaimed and unexpired move. Returns the claimed ids (newest first).
 */
export async function claimScansForSession(params: {
  sessionHash: string;
  userId: string;
  organizationId: string;
  userCreatedAt?: Date;
}): Promise<string[]> {
  const now = new Date();
  const candidates = await prisma.riskScan.findMany({
    where: { sessionHash: params.sessionHash, userId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);

  const { count } = await prisma.riskScan.updateMany({
    where: { id: { in: ids }, userId: null },
    data: { userId: params.userId, organizationId: params.organizationId, claimedAt: now, expiresAt: null },
  });
  if (count === 0) return [];

  const visitorHash = params.sessionHash;
  const justSignedUp = params.userCreatedAt ? now.getTime() - params.userCreatedAt.getTime() < DAY_MS : false;
  if (justSignedUp) await trackScannerEvent("signup_completed", { visitorHash, organizationId: params.organizationId, scanId: ids[0], properties: { from: "scan" } });
  await Promise.all(ids.map((scanId) => trackScannerEvent("scan_claimed", { visitorHash, organizationId: params.organizationId, scanId })));
  return ids;
}

export type ScanSummary = {
  id: string;
  createdAt: Date;
  score: number;
  level: RiskLevel;
  highRiskCount: number;
  mediumCount: number;
  agentType: string;
  connectedAgentId: string | null;
};

export async function listOrganizationScans(organizationId: string, take = 20): Promise<ScanSummary[]> {
  const rows = await prisma.riskScan.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, score: true, level: true, highRiskCount: true, mediumCount: true, agentType: true, connectedAgentId: true },
  });
  return rows.map((r) => ({ ...r, level: r.level as RiskLevel }));
}

export async function getOrganizationScan(organizationId: string, id: string): Promise<ScanRecord | null> {
  if (!isScanId(id)) return null;
  const row = await prisma.riskScan.findFirst({ where: { id, organizationId } });
  return row ? toRecord(row) : null;
}

/** Links a scan to one of the organization's own agents. The agent must belong to the same organization. */
export async function linkScanToAgent(organizationId: string, scanId: string, agentId: string): Promise<boolean> {
  if (!isScanId(scanId)) return false;
  // Only an agent that has really contacted Aegis can be the subject of a scan link: a pending record is not an agent yet.
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId, connection: { is: { firstHandshakeAt: { not: null } } } }, select: { id: true } });
  if (!agent) return false;
  const { count } = await prisma.riskScan.updateMany({ where: { id: scanId, organizationId }, data: { connectedAgentId: agent.id } });
  if (count > 0) await trackScannerEvent("agent_connected", { organizationId, scanId, properties: { source: "dashboard" } });
  return count > 0;
}

/** Change between two consecutive scans for the trend panel: what was fixed, what is new, what is still open. */
export function diffScans(previous: ScanResult | null, latest: ScanResult) {
  const prev = new Map((previous?.findings ?? []).map((f) => [f.id, f]));
  const now = new Map(latest.findings.map((f) => [f.id, f]));
  const order = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  return {
    resolved: [...prev.values()].filter((f) => !now.has(f.id)),
    improved: latest.findings.filter((f) => prev.has(f.id) && order[f.severity] < order[prev.get(f.id)!.severity]),
    introduced: previous ? latest.findings.filter((f) => !prev.has(f.id)) : [],
    unresolved: latest.findings,
  };
}
