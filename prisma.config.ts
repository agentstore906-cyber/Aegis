
import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma configuration.
 * DATABASE_URL is required when running migrations,
 * but not necessarily when generating the Prisma client.
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
