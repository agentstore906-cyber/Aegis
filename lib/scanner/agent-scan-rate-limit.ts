import "server-only";

import { createRateLimiter } from "@/lib/rate-limit/postgres";
import type { RateLimiter } from "@/lib/rate-limit/limiter";

/**
 * Abuse protection for the Free Risk Scanner (signed-in, per-agent scans). Deliberately NOT lib/scanner/rate-limit.ts:
 * that file belongs to the retired anonymous questionnaire scanner (keyed by IP / anonymous session) and is not reused.
 *
 * A scan makes about four signed requests to the user's own endpoint and writes one row, so the limits exist to stop a
 * loop or a stuck button hammering a customer's agent — not to ration scans. Defaults leave a Free organization
 * (3 agents) plenty of room: each agent can be scanned 10 times an hour, the whole workspace 30 times an hour.
 * Override with AEGIS_AGENT_SCAN_AGENT_HOURLY_LIMIT / AEGIS_AGENT_SCAN_ORG_HOURLY_LIMIT (positive integers).
 * The limit is the same on every plan: the scanner is free, and so is its fair-use ceiling.
 */

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_AGENT_LIMIT = 10;
const DEFAULT_ORG_LIMIT = 30;

export function readScanLimit(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type AgentScanLimiters = { perAgent: RateLimiter; perOrganization: RateLimiter };

let defaults: AgentScanLimiters | null = null;
function defaultLimiters(): AgentScanLimiters {
  defaults ??= {
    perAgent: createRateLimiter("agent-scan.agent", readScanLimit(process.env.AEGIS_AGENT_SCAN_AGENT_HOURLY_LIMIT, DEFAULT_AGENT_LIMIT), HOUR_MS),
    perOrganization: createRateLimiter("agent-scan.org", readScanLimit(process.env.AEGIS_AGENT_SCAN_ORG_HOURLY_LIMIT, DEFAULT_ORG_LIMIT), HOUR_MS),
  };
  return defaults;
}

export type AgentScanAllowance = { allowed: true } | { allowed: false; message: string };

/**
 * Spends one scan from the agent's and the workspace's hourly budget. Call after authorization and before any
 * network contact. The organization bucket is checked first so a flood of made-up agent slugs cannot create
 * unbounded per-agent buckets.
 */
export async function consumeAgentScan(organizationId: string, agentSlug: string, limiters: AgentScanLimiters = defaultLimiters()): Promise<AgentScanAllowance> {
  const org = await limiters.perOrganization.consume(organizationId);
  if (!org.allowed) return { allowed: false, message: retryMessage("This workspace has run a lot of scans", org.resetAt) };
  const agent = await limiters.perAgent.consume(`${organizationId}:${agentSlug}`);
  if (!agent.allowed) return { allowed: false, message: retryMessage("This agent has been scanned several times already", agent.resetAt) };
  return { allowed: true };
}

function retryMessage(prefix: string, resetAt: Date): string {
  const minutes = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60_000));
  return `${prefix} in the last hour. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
