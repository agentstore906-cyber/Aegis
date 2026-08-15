import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 config file — replaces the `datasource.url` that used to live in
 * schema.prisma. Only the CLI (migrate/generate/studio) reads this; the
 * running app still connects via the @prisma/adapter-pg instance built in
 * lib/db.ts, not through anything here.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
