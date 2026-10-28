import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 config file — replaces the `datasource.url` that used to live in
 * schema.prisma. Only the CLI (migrate/generate/studio) reads this; the
 * running app connects via the @prisma/adapter-pg instance in lib/db.ts.
 *
 * `process.env` rather than `env()` from prisma/config: `env()` throws while
 * the config loads, which would break `prisma generate` (postinstall) when
 * DATABASE_URL is unset. `prisma migrate deploy` still refuses to run
 * without it ("The datasource.url property is required…") — that error means
 * DATABASE_URL is not set in the environment running the build.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
