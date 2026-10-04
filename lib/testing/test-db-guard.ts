/**
 * Integration-test database guard (P0 §11).
 *
 * Integration tests create and `deleteMany` real rows. They must never run
 * against a database that might hold real data. This decides — from
 * configuration alone, before any test runs — which database (if any) the
 * test workers may use. Pure (no I/O), so the rules themselves are unit-tested.
 *
 * Rules:
 *   1. Integration tests use DATABASE_URL_TEST only — never DATABASE_URL.
 *      Unset -> integration tests are skipped (excluded) with a warning, and
 *      workers get an unreachable sentinel DATABASE_URL so nothing can fall
 *      back to the app database.
 *   2. DATABASE_URL_TEST must not point at the same database as any app
 *      DATABASE_URL in play (process env or .env), compared by host, port,
 *      and database name — not by raw string, so a different password or
 *      query string can't disguise the same database.
 *   3. The database name must contain "test".
 *   4. A non-local host additionally requires explicit confirmation:
 *      AEGIS_ALLOW_REMOTE_TEST_DB set to exactly that hostname.
 */

export const UNREACHABLE_TEST_DATABASE_URL = "postgresql://aegis_test_guard:unset@127.0.0.1:9/aegis_test_guard_unset";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type TestDbDecision =
  | { mode: "integration"; databaseUrl: string; host: string; database: string }
  | { mode: "unit-only"; databaseUrl: string; reason: string };

type ParsedDb = { host: string; port: string; database: string };

function parse(url: string): ParsedDb | null {
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || "5432",
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    };
  } catch {
    return null;
  }
}

function sameDatabase(a: ParsedDb, b: ParsedDb): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(`Refusing to run integration tests: ${message}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

export function decideTestDatabase(params: {
  testDatabaseUrl: string | undefined;
  appDatabaseUrls: (string | undefined)[];
  allowRemoteHost: string | undefined;
}): TestDbDecision {
  const testUrl = params.testDatabaseUrl?.trim();
  if (!testUrl) {
    return {
      mode: "unit-only",
      databaseUrl: UNREACHABLE_TEST_DATABASE_URL,
      reason:
        "DATABASE_URL_TEST is not set — integration tests (*.integration.test.ts) are skipped. Point DATABASE_URL_TEST at a disposable local database (e.g. postgresql://aegis:aegis@localhost:5432/aegis_test) to run them.",
    };
  }

  const test = parse(testUrl);
  if (!test || !test.database) throw new UnsafeTestDatabaseError("DATABASE_URL_TEST is not a valid postgresql:// URL with a database name.");

  for (const appUrl of params.appDatabaseUrls) {
    const app = appUrl ? parse(appUrl) : null;
    if (app && sameDatabase(app, test)) {
      throw new UnsafeTestDatabaseError(
        `DATABASE_URL_TEST points at the same database as DATABASE_URL (${test.host}/${test.database}). Use a separate, disposable test database.`
      );
    }
  }

  if (!test.database.toLowerCase().includes("test")) {
    throw new UnsafeTestDatabaseError(
      `the test database name "${test.database}" must contain "test" (e.g. aegis_test), so a real database can't be used by mistake.`
    );
  }

  if (!LOCAL_HOSTS.has(test.host) && params.allowRemoteHost?.trim().toLowerCase() !== test.host) {
    throw new UnsafeTestDatabaseError(
      `DATABASE_URL_TEST host "${test.host}" is not local. If this really is a disposable test database, confirm by setting AEGIS_ALLOW_REMOTE_TEST_DB=${test.host}.`
    );
  }

  return { mode: "integration", databaseUrl: testUrl, host: test.host, database: test.database };
}
