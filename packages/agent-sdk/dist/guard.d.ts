import type { AlertResult, AllowResult, AuthorizationResult, GuardInput, TrackEventInput, TrackEventResult, AuthorizeInput, ApprovalStatusResult, WaitForApprovalInput } from "./types.js";
/** What guard() needs from the client (kept narrow so it is easy to test and cannot reach anything else). */
export type GuardClient = {
    authorize(input: AuthorizeInput): Promise<AuthorizationResult>;
    track(input: TrackEventInput): Promise<TrackEventResult>;
    waitForApproval(input: WaitForApprovalInput): Promise<ApprovalStatusResult>;
};
/**
 * True for failures that mean "Aegis could not be reached or is unwell"
 * (network, timeout, rate limit, 5xx). Everything else — a rejected key, an
 * invalid request, an unknown agent, a 403 — means the integration is WRONG,
 * not that Aegis is down, and must never be treated as permission to proceed.
 */
export declare function isOutage(error: unknown): boolean;
/**
 * In-process enforcement for ONE tool call: authorize → run the tool only on
 * an allowing decision → report what happened under that decision.
 *
 *   ALLOW / ALERT       run `fn`, report SUCCESS or FAILURE linked to the decision
 *   BLOCK               throw AegisBlockedError — `fn` never runs
 *   REQUIRE_APPROVAL    throw AegisApprovalRequiredError, or (onApproval: "wait") wait for the
 *                       human, then run `fn` exactly once under the single-use approval
 *   Aegis unreachable   FAIL CLOSED by default (AegisUnavailableError, `fn` never runs);
 *                       onUnavailable: "open" runs `fn` and reports it as unguarded
 *
 * What this is, honestly: a refusal point inside YOUR process for the calls
 * you route through it. It does not and cannot stop code that calls the tool
 * directly, bypassing guard(). Aegis shows that gap as enforcement coverage.
 *
 * Reporting never changes the outcome: a failed report is passed to
 * `onReportError` and swallowed, so a telemetry problem can neither mask the
 * tool's result nor trigger a retry that would run the tool twice.
 */
export declare function guard<T>(client: GuardClient, input: GuardInput, fn: (decision: AllowResult | AlertResult | null) => Promise<T> | T): Promise<T>;
//# sourceMappingURL=guard.d.ts.map