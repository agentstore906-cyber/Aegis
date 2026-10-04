/** P1 §4 — one representation per concept. */
import { describe, expect, it } from "vitest";

import {
  normalizeDataClasses,
  normalizeDestination,
  normalizeKey,
  REPORTED_STATUS_TO_OUTCOME,
  sensitivityForDataClasses,
} from "@/lib/telemetry/normalize";

describe("normalizeKey (tools, services)", () => {
  it("collapses case and spacing variants of the same name into one key", () => {
    for (const variant of ["Zendesk API", " zendesk  api ", "ZENDESK-API", "zendesk--api", "Zendesk / API"]) {
      expect(normalizeKey(variant)).toBe("zendesk-api");
    }
  });

  it("keeps '_' and '.' so it doesn't guess that different spellings are the same product", () => {
    expect(normalizeKey("zendesk_api")).toBe("zendesk_api");
    expect(normalizeKey("api.stripe")).toBe("api.stripe");
  });

  it("returns null for empty or symbol-only input, and caps length at 60 without a trailing dash", () => {
    expect(normalizeKey("")).toBeNull();
    expect(normalizeKey("   ")).toBeNull();
    expect(normalizeKey("!!!")).toBeNull();
    expect(normalizeKey(undefined)).toBeNull();
    const long = normalizeKey(`${"a".repeat(59)} b`);
    expect(long).toBe("a".repeat(59));
    expect(normalizeKey("x".repeat(80))).toHaveLength(60);
  });
});

describe("normalizeDestination", () => {
  it("keeps only the host of a URL — never the path, query, credentials, or port", () => {
    const result = normalizeDestination("https://user:p4ss@Files.Example-Share.io:8443/upload?token=abc#frag");
    expect(result).toEqual({ ok: true, value: { destination: "files.example-share.io", kind: "HOST" } });
  });

  it("accepts bare hosts (with or without a path) and strips a trailing dot", () => {
    expect(normalizeDestination("api.stripe.com/v1/charges")).toEqual({ ok: true, value: { destination: "api.stripe.com", kind: "HOST" } });
    expect(normalizeDestination("API.Stripe.com.")).toEqual({ ok: true, value: { destination: "api.stripe.com", kind: "HOST" } });
  });

  it("reduces an email address to its domain — the local part is never kept", () => {
    expect(normalizeDestination("Jane.Doe@Customer.example.com")).toEqual({
      ok: true,
      value: { destination: "customer.example.com", kind: "EMAIL_DOMAIN" },
    });
  });

  it("identifies IPv4 and IPv6 destinations", () => {
    expect(normalizeDestination("http://10.0.0.5:9000/x")).toEqual({ ok: true, value: { destination: "10.0.0.5", kind: "IP" } });
    expect(normalizeDestination("http://[2001:db8::1]/x")).toEqual({ ok: true, value: { destination: "2001:db8::1", kind: "IP" } });
  });

  it("stores internationalized hosts in one (punycode) form", () => {
    expect(normalizeDestination("https://bücher.example/")).toEqual({
      ok: true,
      value: { destination: "xn--bcher-kva.example", kind: "HOST" },
    });
  });

  it("rejects things that aren't a destination", () => {
    for (const bad of ["", "   ", "not a host", "https://", "user@", "@example.com", "javascript:alert(1)"]) {
      expect(normalizeDestination(bad).ok).toBe(false);
    }
  });
});

describe("data classes and sensitivity", () => {
  it("normalizes case, de-duplicates, and returns a stable order", () => {
    expect(normalizeDataClasses(["pii", "FINANCIAL", "Pii"])).toEqual({ ok: true, value: ["PII", "FINANCIAL"] });
  });

  it("rejects unknown classes instead of dropping them", () => {
    const result = normalizeDataClasses(["PII", "secret-sauce"]);
    expect(result.ok).toBe(false);
  });

  it("derives sensitivity from the most sensitive class; a declaration can raise but never lower it", () => {
    expect(sensitivityForDataClasses(["PUBLIC"])).toBe("LOW");
    expect(sensitivityForDataClasses(["INTERNAL", "PII"])).toBe("HIGH");
    expect(sensitivityForDataClasses(["CREDENTIALS"])).toBe("CRITICAL");
    expect(sensitivityForDataClasses(["PII"], "LOW")).toBe("HIGH");
    expect(sensitivityForDataClasses(["PUBLIC"], "HIGH")).toBe("HIGH");
  });

  it("is unknown (null), not LOW, when nothing was reported", () => {
    expect(sensitivityForDataClasses([])).toBeNull();
    expect(sensitivityForDataClasses([], "MEDIUM")).toBe("MEDIUM");
  });
});

describe("outcomes", () => {
  it("maps every reported status to exactly one outcome", () => {
    expect(REPORTED_STATUS_TO_OUTCOME).toEqual({ SUCCESS: "SUCCESS", FAILURE: "FAILURE", BLOCKED: "BLOCKED", WARNING: "WARNING" });
  });
});
