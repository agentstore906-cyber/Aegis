/**
 * Canonical site URL for metadata (Open Graph, sitemap, robots, canonical
 * links). Reuses `AUTH_URL` — already the "public base URL of the
 * deployment" per lib/env.ts — rather than inventing a second env var for
 * the same concept. (lib/billing/actions.ts prefers NEXT_PUBLIC_APP_URL and
 * falls back to this same value for the Lemon Squeezy return URL.)
 */
export function getSiteUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}
