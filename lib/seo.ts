/**
 * Canonical site URL for metadata (Open Graph, sitemap, robots, canonical
 * links). Reuses `AUTH_URL` — already the "public base URL of the
 * deployment" per lib/env.ts and the exact pattern lib/billing/actions.ts
 * uses for Stripe redirect URLs — rather than inventing a second env var
 * for the same concept.
 */
export function getSiteUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}
