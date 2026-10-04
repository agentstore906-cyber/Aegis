/**
 * Control plane: policy conditions on agent-reported telemetry (destination,
 * service, data classes, sensitivity, volume). The security-relevant property
 * is fail-closed behavior: an agent cannot dodge a restrictive policy by not
 * reporting the field. Pure resolver/matcher tests; the end-to-end version is
 * in lib/__tests__/control-plane.integration.test.ts.
 */
import { describe, expect, it } from "vitest";

import { evaluateConditionStrict, resolveField } from "@/lib/policies/conditions";
import { policyMatches } from "@/lib/policies/matcher";
import { conditionSchema } from "@/lib/validation/policy";
import { makeCondition, makeInput, makePolicy } from "@/lib/policies/__tests__/fixtures";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

const withTelemetry = (telemetry: PolicyEvaluationInput["telemetry"]) => makeInput({ action: "crm.export", telemetry });

describe("resolveField — telemetry fields", () => {
  const input = withTelemetry({
    service: "crm-api",
    destination: { destination: "api.crm.example.com", kind: "HOST" },
    dataClasses: ["PII", "FINANCIAL"],
    recordCount: 80,
    byteCount: 4096,
  });

  it("resolves destination, service, volume", () => {
    expect(resolveField("destination", input)).toBe("api.crm.example.com");
    expect(resolveField("service", input)).toBe("crm-api");
    expect(resolveField("recordCount", input)).toBe(80);
    expect(resolveField("byteCount", input)).toBe(4096);
  });

  it("resolves data.<CLASS> to true/false once classes are reported", () => {
    expect(resolveField("data.PII", input)).toBe(true);
    expect(resolveField("data.FINANCIAL", input)).toBe(true);
    expect(resolveField("data.CREDENTIALS", input)).toBe(false);
    expect(resolveField("data.HEALTH", withTelemetry({ dataClasses: [] }))).toBe(false); // reported as "none" is a definite false
  });

  it("derives dataSensitivity from the classes, and a caller's own declaration can only raise it", () => {
    expect(resolveField("dataSensitivity", input)).toBe("HIGH");
    expect(resolveField("dataSensitivity", withTelemetry({ dataClasses: ["HEALTH"], dataSensitivity: "LOW" }))).toBe("CRITICAL");
    expect(resolveField("dataSensitivity", withTelemetry({ dataClasses: ["PUBLIC"], dataSensitivity: "HIGH" }))).toBe("HIGH");
  });

  it("an unreported field is undefined — never 'none' or false", () => {
    const bare = withTelemetry(undefined);
    for (const f of ["destination", "service", "recordCount", "byteCount", "dataSensitivity", "data.PII"]) expect(resolveField(f, bare), f).toBeUndefined();
    expect(resolveField("data.PII", withTelemetry({ service: "x" }))).toBeUndefined(); // classes not reported
    expect(resolveField("destination", withTelemetry({ service: "x" }))).toBeUndefined();
  });

  it("rejects malformed data paths and never reads arbitrary properties", () => {
    expect(resolveField("data", input)).toBeUndefined();
    expect(resolveField("data.NOPE", input)).toBeUndefined();
    expect(resolveField("data.PII.extra", input)).toBeUndefined();
    expect(resolveField("data.__proto__", input)).toBeUndefined();
    expect(resolveField("destination.kind", input)).toBeUndefined();
    expect(resolveField("telemetry.service", input)).toBeUndefined();
    expect(resolveField("endUserId", withTelemetry({ endUserId: "u1" }))).toBeUndefined(); // end-user ids are never policy-addressable
  });
});

describe("destination allow-list policy (BLOCK when not in the list)", () => {
  const allowList = makePolicy({
    action: "crm.export",
    decision: "BLOCK",
    conditions: [makeCondition({ field: "destination", operator: "NOT_IN", value: ["api.crm.example.com", "files.corp.example.com"] })],
  });

  it("blocks an unlisted destination, allows a listed one", () => {
    expect(policyMatches(allowList, withTelemetry({ destination: { destination: "evil.example", kind: "HOST" } }))).toBe(true);
    expect(policyMatches(allowList, withTelemetry({ destination: { destination: "api.crm.example.com", kind: "HOST" } }))).toBe(false);
  });

  it("FAIL-CLOSED: omitting the destination does not slip past the allow-list", () => {
    expect(policyMatches(allowList, withTelemetry(undefined))).toBe(true);
    expect(policyMatches(allowList, withTelemetry({ service: "crm-api" }))).toBe(true);
  });

  it("LEGACY mode (explicit pre-P0 opt-out) keeps its old semantics: a missing field is a false condition", () => {
    expect(policyMatches(allowList, withTelemetry(undefined), "LEGACY")).toBe(false);
  });
});

describe("data policies", () => {
  const blockCredentials = makePolicy({ action: "crm.export", decision: "BLOCK", conditions: [makeCondition({ field: "data.CREDENTIALS", operator: "EQUALS", value: true })] });
  const approveSensitive = makePolicy({ action: "crm.export", decision: "REQUIRE_APPROVAL", conditions: [makeCondition({ field: "dataSensitivity", operator: "IN", value: ["HIGH", "CRITICAL"] })] });
  const blockBulk = makePolicy({ action: "crm.export", decision: "BLOCK", conditions: [makeCondition({ field: "recordCount", operator: "GREATER_THAN", value: 1000 })] });

  it("matches when the reported data says so, not otherwise", () => {
    expect(policyMatches(blockCredentials, withTelemetry({ dataClasses: ["CREDENTIALS"] }))).toBe(true);
    expect(policyMatches(blockCredentials, withTelemetry({ dataClasses: ["PII"] }))).toBe(false);
    expect(policyMatches(approveSensitive, withTelemetry({ dataClasses: ["PII"] }))).toBe(true);
    expect(policyMatches(approveSensitive, withTelemetry({ dataClasses: ["INTERNAL"] }))).toBe(false);
    expect(policyMatches(blockBulk, withTelemetry({ recordCount: 5000 }))).toBe(true);
    expect(policyMatches(blockBulk, withTelemetry({ recordCount: 10 }))).toBe(false);
  });

  it("FAIL-CLOSED: not reporting data classes or volume does not escape restrictive data policies", () => {
    for (const policy of [blockCredentials, approveSensitive, blockBulk]) expect(policyMatches(policy, withTelemetry(undefined))).toBe(true);
  });

  it("an ALLOW policy on a field the agent did not report does NOT match (silence never grants)", () => {
    const allowInternalOnly = makePolicy({ action: "crm.export", decision: "ALLOW", conditions: [makeCondition({ field: "data.PII", operator: "EQUALS", value: false })] });
    expect(policyMatches(allowInternalOnly, withTelemetry(undefined))).toBe(false);
    expect(policyMatches(allowInternalOnly, withTelemetry({ dataClasses: ["INTERNAL"] }))).toBe(true);
    expect(policyMatches(allowInternalOnly, withTelemetry({ dataClasses: ["PII"] }))).toBe(false);
  });

  it("the strict evaluator reports indeterminate (null) for unreported telemetry, definite booleans otherwise", () => {
    const resolve = (t: PolicyEvaluationInput["telemetry"]) => resolveField("recordCount", withTelemetry(t));
    expect(evaluateConditionStrict("GREATER_THAN", resolve(undefined), 100)).toBeNull();
    expect(evaluateConditionStrict("GREATER_THAN", resolve({ recordCount: 500 }), 100)).toBe(true);
    expect(evaluateConditionStrict("GREATER_THAN", resolve({ recordCount: 5 }), 100)).toBe(false);
  });
});

describe("policy validation accepts exactly the supported telemetry fields", () => {
  const ok = (field: string, operator = "EQUALS", value: unknown = "x") => conditionSchema.safeParse({ field, operator, value }).success;

  it.each(["destination", "service", "dataSensitivity", "recordCount", "byteCount", "data.PII", "data.CREDENTIALS", "context.amount"])("accepts %s", (field) => {
    expect(ok(field)).toBe(true);
  });

  it.each(["data", "data.NOPE", "data.pii", "data.PII.x", "endUserId", "endUserHash", "telemetry.service", "destination.kind", "organizationId", "agent"])("rejects %s", (field) => {
    expect(ok(field)).toBe(false);
  });
});
