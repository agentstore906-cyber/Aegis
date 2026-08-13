export type ApiErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "REVOKED_API_KEY"
  | "EXPIRED_API_KEY"
  | "INSUFFICIENT_SCOPE"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "AGENT_NOT_FOUND"
  | "FORBIDDEN"
  | "POLICY_EVALUATION_FAILED"
  | "APPROVAL_NOT_FOUND"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "INTERNAL_ERROR";

/**
 * The one error shape every app/api/v1/* route throws and returns.
 * Message text is always safe for an external caller to read — never a
 * stack trace, never an internal implementation detail.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: ApiError, requestId: string): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status, headers: { "x-aegis-request-id": requestId } }
  );
}
