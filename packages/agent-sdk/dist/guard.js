import { AegisApiError, AegisBlockedError, AegisApprovalRequiredError, AegisNetworkError, AegisRateLimitError, AegisTimeoutError, AegisUnavailableError } from "./errors.js";
/**
 * True for failures that mean "Aegis could not be reached or is unwell"
 * (network, timeout, rate limit, 5xx). Everything else — a rejected key, an
 * invalid request, an unknown agent, a 403 — means the integration is WRONG,
 * not that Aegis is down, and must never be treated as permission to proceed.
 */
export function isOutage(error) {
    if (error instanceof AegisNetworkError || error instanceof AegisTimeoutError || error instanceof AegisRateLimitError)
        return true;
    return error instanceof AegisApiError && error.status >= 500;
}
const EVENT_FIELDS = ["agent", "resource", "tool", "traceId", "service", "destination", "endUserId", "dataClasses", "dataSensitivity", "recordCount", "byteCount"];
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
export async function guard(client, input, fn) {
    const { onUnavailable = "closed", onApproval = "throw", approvalTimeoutMs, report, onReportError, ...authorizeInput } = input;
    let decision;
    try {
        decision = await client.authorize(authorizeInput);
    }
    catch (error) {
        if (isOutage(error)) {
            if (onUnavailable === "open")
                return runAndReport(client, input, null, fn, true, onReportError);
            throw new AegisUnavailableError("Aegis could not be reached, so the action was not run (fail closed). Set onUnavailable: \"open\" to run unguarded instead.", error);
        }
        throw error; // a rejected request is a bug to fix, never a reason to proceed
    }
    if (decision.decision === "REQUIRE_APPROVAL") {
        if (onApproval !== "wait")
            throw new AegisApprovalRequiredError(decision);
        const approval = await client.waitForApproval({ approvalRequestId: decision.approvalRequestId, timeoutMs: approvalTimeoutMs });
        if (approval.status !== "APPROVED") {
            throw new AegisBlockedError(decision, `The approval was ${approval.status.toLowerCase()}, so the action was not run.`);
        }
        // Approvals are single-use and bound to this exact request: ask again, with the approval, for the one ALLOW it grants.
        decision = await client.authorize({ ...authorizeInput, approvalRequestId: decision.approvalRequestId, idempotencyKey: undefined });
    }
    if (decision.decision === "ALLOW" || decision.decision === "ALERT")
        return runAndReport(client, input, decision, fn, false, onReportError);
    throw new AegisBlockedError(decision, decision.reason);
}
async function runAndReport(client, input, decision, fn, unguarded, onReportError) {
    const startedAt = Date.now();
    let failure;
    let failed = false;
    let value;
    try {
        value = await fn(decision);
    }
    catch (error) {
        failed = true;
        failure = error;
    }
    try {
        const base = {};
        for (const field of EVENT_FIELDS)
            if (input[field] !== undefined)
                base[field] = input[field];
        await client.track({
            ...base,
            eventType: input.report?.eventType ?? (input.tool ? "TOOL_CALL" : "ACTION"),
            action: input.action,
            description: input.report?.description,
            status: failed ? "FAILURE" : "SUCCESS",
            durationMs: input.report?.durationMs ?? Date.now() - startedAt,
            traceId: decision?.traceId ?? input.traceId,
            evaluationId: decision?.evaluationId,
            metadata: { ...input.report?.metadata, ...(unguarded ? { aegisUnavailable: true, unguarded: true } : {}) },
        });
    }
    catch (error) {
        try {
            onReportError?.(error);
        }
        catch {
            /* the callback must not be able to change the outcome either */
        }
    }
    if (failed)
        throw failure;
    return value;
}
//# sourceMappingURL=guard.js.map