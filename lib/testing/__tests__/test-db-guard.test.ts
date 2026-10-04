/** P0 §11 — integration tests can never be pointed at a real database by accident. */
import { describe, expect, it } from "vitest";

import {
  UNREACHABLE_TEST_DATABASE_URL,
  UnsafeTestDatabaseError,
  decideTestDatabase,
} from "@/lib/testing/test-db-guard";

const NEON_PROD = "postgresql://user:pw@ep-withered-feather-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("decideTestDatabase", () => {
  it("skips integration tests (and hands workers an unreachable URL) when DATABASE_URL_TEST is unset", () => {
    const decision = decideTestDatabase({ testDatabaseUrl: undefined, appDatabaseUrls: [NEON_PROD], allowRemoteHost: undefined });
    expect(decision.mode).toBe("unit-only");
    expect(decision.databaseUrl).toBe(UNREACHABLE_TEST_DATABASE_URL);
  });

  it("never falls back to DATABASE_URL", () => {
    const decision = decideTestDatabase({ testDatabaseUrl: "", appDatabaseUrls: [NEON_PROD], allowRemoteHost: undefined });
    expect(decision.databaseUrl).not.toBe(NEON_PROD);
  });

  it("accepts a local database whose name contains 'test'", () => {
    const decision = decideTestDatabase({
      testDatabaseUrl: "postgresql://aegis:aegis@localhost:5432/aegis_test",
      appDatabaseUrls: [NEON_PROD],
      allowRemoteHost: undefined,
    });
    expect(decision).toMatchObject({ mode: "integration", host: "localhost", database: "aegis_test" });
  });

  it("refuses the app database, even with different credentials or query string", () => {
    expect(() =>
      decideTestDatabase({
        testDatabaseUrl: "postgresql://other:creds@localhost:5432/aegis_test?x=1",
        appDatabaseUrls: ["postgresql://aegis:aegis@localhost:5432/aegis_test"],
        allowRemoteHost: undefined,
      })
    ).toThrow(UnsafeTestDatabaseError);
  });

  it("refuses a database whose name doesn't contain 'test'", () => {
    expect(() =>
      decideTestDatabase({
        testDatabaseUrl: "postgresql://aegis:aegis@localhost:5432/aegis",
        appDatabaseUrls: [],
        allowRemoteHost: undefined,
      })
    ).toThrow(/must contain "test"/);
  });

  it("refuses a remote host unless that exact host is explicitly confirmed", () => {
    const remote = "postgresql://u:p@db.example.com:5432/aegis_test";
    expect(() => decideTestDatabase({ testDatabaseUrl: remote, appDatabaseUrls: [], allowRemoteHost: undefined })).toThrow(
      /AEGIS_ALLOW_REMOTE_TEST_DB=db.example.com/
    );
    expect(() =>
      decideTestDatabase({ testDatabaseUrl: remote, appDatabaseUrls: [], allowRemoteHost: "other.example.com" })
    ).toThrow(UnsafeTestDatabaseError);
    expect(decideTestDatabase({ testDatabaseUrl: remote, appDatabaseUrls: [], allowRemoteHost: "db.example.com" }).mode).toBe(
      "integration"
    );
  });

  it("refuses something that isn't a postgres URL", () => {
    expect(() =>
      decideTestDatabase({ testDatabaseUrl: "mysql://localhost/test", appDatabaseUrls: [], allowRemoteHost: undefined })
    ).toThrow(UnsafeTestDatabaseError);
  });
});
