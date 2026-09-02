import { z } from "zod";

/**
 * Validates required environment variables once, at first import, so a
 * missing `DATABASE_URL`/`AUTH_SECRET` fails fast with one clear message
 * instead of surfacing later as an opaque Prisma/NextAuth error deep in a
 * request. Imported from `lib/db.ts`, which every request already touches.
 *
 * Optional integration variables (Lemon Squeezy, future OAuth) are
 * intentionally NOT required here — the app must boot without them; each
 * integration checks its own variables lazily where it's actually used
 * (see `lib/billing/lemonsqueezy.ts`) and degrades to "not configured"
 * rather than failing the whole app. See docs/deployment.md for the full
 * variable list.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL connection string)."),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (run `openssl rand -base64 32`)."),
  // Comma-separated allowlist of emails allowed into /admin/leads (internal-only,
  // not an organization role — see lib/admin/authorization.ts). Unset means nobody
  // can reach it, not "everyone can."
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(
    `Aegis is missing required environment variables:\n${missing}\n\nSee .env.example and docs/deployment.md.`
  );
}

export const env = parsed.data;
