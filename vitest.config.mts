import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
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
});
