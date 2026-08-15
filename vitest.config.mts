import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // Explicit, not incidental: test workers need DATABASE_URL/AUTH_SECRET
    // (lib/env.ts validates both eagerly on import) and now also feed
    // lib/db.ts's @prisma/adapter-pg connection string. `""` as the third
    // arg loads every var from .env, not just VITE_-prefixed ones.
    env: loadEnv(mode, process.cwd(), ""),
  },
  resolve: {
    alias: {
      // Real modules use `import "server-only"` to prevent accidental
      // client-bundle inclusion — a Next.js-specific guard that doesn't
      // resolve under Vitest's plain Node environment. Stub it so tests
      // can import the actual production modules directly.
      "server-only": path.resolve(import.meta.dirname, "lib/policies/__tests__/server-only-stub.ts"),
      "@": path.resolve(import.meta.dirname),
    },
  },
}));
