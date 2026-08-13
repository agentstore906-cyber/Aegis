/**
 * Base for every error this SDK throws. Never wraps or exposes a server
 * stack trace — only the safe `message` the Aegis API itself returned (or
 * a client-side description for network/timeout failures).
 */
export class AegisError extends Error {
  constructor(
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "AegisError";
  }
}

/** The API key was missing, malformed, unrecognized, revoked, or expired. */
export class AegisAuthenticationError extends AegisError {
  constructor(message: string, requestId?: string) {
    super(message, requestId);
    this.name = "AegisAuthenticationError";
  }
}

/** Too many requests. `retryAfterSeconds` mirrors the server's `Retry-After` header when present. */
export class AegisRateLimitError extends AegisError {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
    requestId?: string
  ) {
    super(message, requestId);
    this.name = "AegisRateLimitError";
  }
}

/** The request was rejected: malformed payload, unknown agent, idempotency-key conflict, etc. Not retried automatically. */
export class AegisValidationError extends AegisError {
  constructor(
    message: string,
    public readonly code?: string,
    requestId?: string
  ) {
    super(message, requestId);
    this.name = "AegisValidationError";
  }
}

/** The request never reached the server, or the connection failed. */
export class AegisNetworkError extends AegisError {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AegisNetworkError";
  }
}

/** A request (or waitForApproval's poll loop) exceeded its deadline. */
export class AegisTimeoutError extends AegisError {
  constructor(message: string) {
    super(message);
    this.name = "AegisTimeoutError";
  }
}

/** Any other non-2xx response the more specific error types above don't cover (403 FORBIDDEN, 5xx, etc.). */
export class AegisApiError extends AegisError {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    requestId?: string
  ) {
    super(message, requestId);
    this.name = "AegisApiError";
  }
}
