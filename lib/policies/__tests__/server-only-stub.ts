// Vitest runs outside Next.js's "react-server" module resolution condition,
// so the real `server-only` package (which intentionally throws when
// imported outside that condition) can't be loaded. vitest.config.ts
// aliases `server-only` to this no-op stub so tests can import the actual
// production modules (lib/policies/repository.ts, evaluate.ts) directly
// instead of reimplementing their logic.
export {};
