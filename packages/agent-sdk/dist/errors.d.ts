/**
 * Base for every error this SDK throws. Never wraps or exposes a server
 * stack trace — only the safe `message` the Aegis API itself returned (or
 * a client-side description for network/timeout failures).
 */
export declare class AegisError extends Error {
    readonly requestId?: string | undefined;
    constructor(message: string, requestId?: string | undefined);
}
/** The API key was missing, malformed, unrecognized, revoked, or expired. */
export declare class AegisAuthenticationError extends AegisError {
    constructor(message: string, requestId?: string);
}
/** Too many requests. `retryAfterSeconds` mirrors the server's `Retry-After` header when present. */
export declare class AegisRateLimitError extends AegisError {
    readonly retryAfterSeconds?: number | undefined;
    constructor(message: string, retryAfterSeconds?: number | undefined, requestId?: string);
}
/** The request was rejected: malformed payload, unknown agent, idempotency-key conflict, etc. Not retried automatically. */
export declare class AegisValidationError extends AegisError {
    readonly code?: string | undefined;
    constructor(message: string, code?: string | undefined, requestId?: string);
}
/** The request never reached the server, or the connection failed. */
export declare class AegisNetworkError extends AegisError {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/** A request (or waitForApproval's poll loop) exceeded its deadline. */
export declare class AegisTimeoutError extends AegisError {
    constructor(message: string);
}
/** Any other non-2xx response the more specific error types above don't cover (403 FORBIDDEN, 5xx, etc.). */
export declare class AegisApiError extends AegisError {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status: number, requestId?: string);
}
/** guard(): Aegis returned BLOCK (or an approval was rejected/expired). The tool was NOT run. */
export declare class AegisBlockedError extends AegisError {
    readonly decision: {
        decision: string;
        evaluationId: string;
        traceId: string;
        reason?: string;
    };
    constructor(decision: {
        decision: string;
        evaluationId: string;
        traceId: string;
        reason?: string;
    }, message?: string);
}
/** guard(): the action needs a human decision first. The tool was NOT run. `approvalRequestId` is the request to wait on. */
export declare class AegisApprovalRequiredError extends AegisError {
    readonly decision: {
        decision: string;
        evaluationId: string;
        traceId: string;
        approvalRequestId: string;
        reason?: string;
    };
    readonly approvalRequestId: string;
    constructor(decision: {
        decision: string;
        evaluationId: string;
        traceId: string;
        approvalRequestId: string;
        reason?: string;
    });
}
/** guard(): Aegis could not be reached and guard() failed closed. The tool was NOT run. */
export declare class AegisUnavailableError extends AegisError {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
//# sourceMappingURL=errors.d.ts.map