import "server-only";

import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";
import { createLeadSchema } from "@/lib/validation/lead";
import * as repo from "@/lib/leads/repository";

/** 5 submissions/hour per IP — generous for a real prospect, useless to a bot doing volume. */
const leadRateLimiter = new InMemoryRateLimiter(5, 60 * 60 * 1000);

export type SubmitLeadResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * `honeypot` is a form field real users never see (hidden via CSS, no
 * `name` a password manager would try to fill) — a non-empty value means a
 * bot filled every field it could find. We report success without writing
 * anything, so the bot gets no signal that it was caught. `ip` is resolved
 * by the caller (lib/leads/actions.ts) from request headers — kept out of
 * this module so it stays testable without a Next.js request context.
 */
export async function submitLead(raw: Record<string, unknown>, honeypot: string, ip: string): Promise<SubmitLeadResult> {
  if (honeypot.trim().length > 0) {
    return { ok: true, id: "discarded" };
  }

  const parsed = createLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }

  const rateLimit = await leadRateLimiter.consume(ip);
  if (!rateLimit.allowed) {
    return { ok: false, error: "Too many submissions. Please try again later or email us directly." };
  }

  const recentFromSameEmail = await repo.countLeadsCreatedSince(
    parsed.data.email,
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  if (recentFromSameEmail >= 3) {
    return { ok: false, error: "We already have a recent request from this email — we'll be in touch." };
  }

  const lead = await repo.createLead(parsed.data);
  return { ok: true, id: lead.id };
}
