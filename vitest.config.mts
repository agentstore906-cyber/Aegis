import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

import { decideTestDatabase } from "./lib/testing/test-db-guard.ts";

const INTEGRATION_GLOB = "**/*.integration.test.ts";

export default defineConfig(({ mode }) => {
  // Test workers need DATABASE_URL/AUTH_SECRET (lib/env.ts validates both
  // eagerly on import). `""` as the third arg loads every var from .env,
  // not just VITE_-prefixed ones.
  const fileEnv = loadEnv(mode, process.cwd(), "");

  // P0 §11: integration tests NEVER use DATABASE_URL — only a separately
  // configured, verified DATABASE_URL_TEST (see lib/testing/test-db-guard.ts).
  // Throws (aborting the whole run) on an unsafe configuration.
  const decision = decideTestDatabase({
    testDatabaseUrl: process.env.DATABASE_URL_TEST ?? fileEnv.DATABASE_URL_TEST,
    appDatabaseUrls: [process.env.DATABASE_URL, fileEnv.DATABASE_URL],
    allowRemoteHost: process.env.AEGIS_ALLOW_REMOTE_TEST_DB ?? fileEnv.AEGIS_ALLOW_REMOTE_TEST_DB,
  });

  if (decision.mode === "unit-only") {
    console.warn(`\n[aegis] ${decision.reason}\n`);
  } else {
    console.info(`\n[aegis] Integration tests enabled against ${decision.host}/${decision.database}\n`);
  }

  return {
    test: {
      include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.{ts,tsx}"],
      exclude: ["**/node_modules/**", ...(decision.mode === "unit-only" ? [INTEGRATION_GLOB] : [])],
      env: {
        ...fileEnv,
        // Overrides whatever .env / the shell said: workers can only ever
        // reach the verified test database, or an unreachable sentinel.
        DATABASE_URL: decision.databaseUrl,
        AEGIS_VERIFIED_TEST_DATABASE_URL: decision.databaseUrl,
        NODE_ENV: "test",
      },
      setupFiles: [path.resolve(import.meta.dirname, "lib/testing/assert-test-database.setup.ts")],
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
  };
});
