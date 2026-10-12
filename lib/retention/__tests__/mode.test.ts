import { describe, expect, it } from "vitest";

import { resolvePurgeMode } from "@/lib/retention/mode";

const url = (query = "") => new URL(`http://localhost/api/internal/retention/purge${query}`);
const ENABLED = { AEGIS_RETENTION_PURGE_ENABLED: "true" };

describe("resolvePurgeMode — nothing but an explicit, enabled delete request can delete", () => {
  it("the default (no parameters) is a dry run, even when delete is enabled in the deployment", () => {
    expect(resolvePurgeMode(url(), {})).toEqual({ kind: "dry_run" });
    expect(resolvePurgeMode(url(), ENABLED)).toEqual({ kind: "dry_run" });
  });

  it("explicit dry-run spellings and the legacy dryRun parameter (in any value) are dry runs", () => {
    for (const q of ["?mode=dry-run", "?mode=dry_run", "?mode=", "?dryRun=1", "?dryRun=0", "?dryRun=false", "?dryrun=1", "?dryRun=true"]) {
      expect(resolvePurgeMode(url(q), ENABLED)).toEqual({ kind: "dry_run" });
    }
  });

  it("?mode=delete is refused (409) unless the deployment explicitly enables it", () => {
    for (const env of [{}, { AEGIS_RETENTION_PURGE_ENABLED: undefined }, { AEGIS_RETENTION_PURGE_ENABLED: "" }, { AEGIS_RETENTION_PURGE_ENABLED: "1" }, { AEGIS_RETENTION_PURGE_ENABLED: "TRUE" }, { AEGIS_RETENTION_PURGE_ENABLED: "false" }]) {
      expect(resolvePurgeMode(url("?mode=delete"), env)).toMatchObject({ kind: "refused", status: 409 });
    }
  });

  it("deletes only for ?mode=delete AND AEGIS_RETENTION_PURGE_ENABLED=true", () => {
    expect(resolvePurgeMode(url("?mode=delete"), ENABLED)).toEqual({ kind: "delete" });
  });

  it("an unrecognized mode (typo, wrong case) is refused (400), never guessed", () => {
    for (const q of ["?mode=Delete", "?mode=DELETE", "?mode=purge", "?mode=delet", "?mode=true"]) {
      expect(resolvePurgeMode(url(q), ENABLED)).toMatchObject({ kind: "refused", status: 400 });
    }
  });
});
