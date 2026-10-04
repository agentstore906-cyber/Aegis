import { afterEach } from "vitest";

import { drainDeferredTasks } from "@/lib/server/defer";

/**
 * Runs in every test worker before any test file (vitest setupFiles).
 *
 * 1. Defense in depth for P0 §11: even if something re-loads .env or mutates
 *    process.env after vitest.config.mts decided which database is allowed,
 *    no test may start with a DATABASE_URL other than the verified one.
 * 2. Side effects scheduled with lib/server/defer.ts run immediately outside
 *    a request scope; never let one leak into the next test or race its
 *    cleanup.
 */
const verified = process.env.AEGIS_VERIFIED_TEST_DATABASE_URL;

if (!verified || process.env.DATABASE_URL !== verified) {
  throw new Error(
    "[aegis] Test worker DATABASE_URL does not match the verified test database — refusing to run. See lib/testing/test-db-guard.ts."
  );
}

afterEach(async () => {
  await drainDeferredTasks();
});
