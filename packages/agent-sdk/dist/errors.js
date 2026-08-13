/**
 * Base for every error this SDK throws. Never wraps or exposes a server
 * stack trace — only the safe `message` the Aegis API itself returned (or
 * a client-side description for network/timeout failures).
 */
export class AegisError extends Error {
    requestId;
    constructor(message, requestId) {
        super(message);
        this.requestId = requestId;
        this.name = "AegisError";
    }
}
/** The API key was missing, malformed, unrecognized, revoked, or expired. */
export class AegisAuthenticationError extends AegisError {
    constructor(message, requestId) {
        super(message, requestId);
        this.name = "AegisAuthenticationError";
    }
}
/** Too many requests. `retryAfterSeconds` mirrors the server's `Retry-After` header when present. */
export class AegisRateLimitError extends AegisError {
    retryAfterSeconds;
    constructor(message, retryAfterSeconds, requestId) {
        super(message, requestId);
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = "AegisRateLimitError";
    }
}
/** The request was rejected: malformed payload, unknown agent, idempotency-key conflict, etc. Not retried automatically. */
export class AegisValidationError extends AegisError {
    code;
    constructor(message, code, requestId) {
        super(message, requestId);
        this.code = code;
        this.name = "AegisValidationError";
    }
}
/** The request never reached the server, or the connection failed. */
export class AegisNetworkError extends AegisError {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "AegisNetworkError";
    }
}
/** A request (or waitForApproval's poll loop) exceeded its deadline. */
export class AegisTimeoutError extends AegisError {
    constructor(message) {
        super(message);
        this.name = "AegisTimeoutError";
    }
}
/** Any other non-2xx response the more specific error types above don't cover (403 FORBIDDEN, 5xx, etc.). */
export class AegisApiError extends AegisError {
    code;
    status;
    constructor(message, code, status, requestId) {
        super(message, requestId);
        this.code = code;
        this.status = status;
        this.name = "AegisApiError";
    }
}
//# sourceMappingURL=errors.js.map