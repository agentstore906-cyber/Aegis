import "server-only";

import { createRateLimiter } from "@/lib/rate-limit/postgres";

/**
 * Abuse protection for the unauthenticated scanner endpoints. Keyed by client IP (best effort, from
 * proxy headers) and — for creation — additionally by anonymous session, so rotating IPs doesn't
 * bypass the per-browser cap. Backed by the shared Postgres limiter in production.
 */
export const scanCreateHourly = createRateLimiter("scan.create.ip", 10, 60 * 60 * 1000);
export const scanCreateDaily = createRateLimiter("scan.create.day", 30, 24 * 60 * 60 * 1000);
export const scanCreateSession = createRateLimiter("scan.create.session", 15, 24 * 60 * 60 * 1000);
export const scanEventsLimiter = createRateLimiter("scan.events", 120, 60 * 1000);
export const scanShareLimiter = createRateLimiter("scan.share", 30, 60 * 60 * 1000);
