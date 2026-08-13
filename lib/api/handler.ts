import "server-only";

import { randomUUID } from "node:crypto";
import type { ApiKey, Organization } from "@prisma/client";

import { authenticateApiKey, requireScope } from "@/lib/api-keys/service";
import {
  ExpiredApiKeyError,
  InsufficientScopeError,
  InvalidApiKeyError,
  MissingApiKeyError,
  RevokedApiKeyError,
} from "@/lib/api-keys/types";
import { apiRateLimiter } from "@/lib/rate-limit/limiter";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { logApiRequest } from "@/lib/api/logger";

export type ApiContext = {
  organization: Organization;
  apiKey: ApiKey;
  requestId: string;
  /** Lets a route report which agent a request touched, purely for the request log. */
  setAgentId: (agentId: string) => void;
};

function mapAuthError(error: unknown): ApiError | null {
  if (error instanceof MissingApiKeyError || error instanceof InvalidApiKeyError) {
    return new ApiError("INVALID_API_KEY", error.message, 401);
  }
  if (error instanceof RevokedApiKeyError) return new ApiError("REVOKED_API_KEY", error.message, 401);
  if (error instanceof ExpiredApiKeyError) return new ApiError("EXPIRED_API_KEY", error.message, 401);
  if (error instanceof InsufficientScopeError) return new ApiError("INSUFFICIENT_SCOPE", error.message, 403);
  return null;
}

/**
 * The one composition point every app/api/v1/* route handler goes
 * through: request id, authentication, scope check, rate limiting,
 * uniform error formatting, and structured logging. Route handlers stay
 * thin — this is where all of that lives exactly once.
 *
 * `routeContext` is passed through untouched from Next.js's route handler
 * signature (e.g. `{ params: Promise<{ id: string }> }` for a `[id]`
 * segment) so dynamic routes like /api/v1/approvals/[id] can still read
 * their params without withApiAuth needing to know their shape. The
 * default type matches what Next.js's generated route validator expects
 * for a route with *no* dynamic segments (`{ params: Promise<{}> }`) —
 * routes that don't need it can simply ignore the third handler argument.
 */
export function withApiAuth<RouteContext = { params: Promise<Record<string, string>> }>(
  endpoint: string,
  requiredScope: string,
  handler: (request: Request, ctx: ApiContext, routeContext: RouteContext) => Promise<Response>
) {
  return async function routeHandler(request: Request, routeContext: RouteContext): Promise<Response> {
    const requestId = randomUUID();
    const startedAt = Date.now();

    let organizationId: string | undefined;
    let apiKeyId: string | undefined;
    let apiKeyPrefix: string | undefined;
    let agentId: string | undefined;
    let status = 500;

    try {
      const { organization, apiKey } = await authenticateApiKey(request.headers.get("authorization"));
      organizationId = organization.id;
      apiKeyId = apiKey.id;
      apiKeyPrefix = apiKey.prefix;

      requireScope(apiKey.scopes, requiredScope);

      const rateLimit = await apiRateLimiter.consume(apiKey.id);
      if (!rateLimit.allowed) {
        status = 429;
        const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000));
        return Response.json(
          { error: { code: "RATE_LIMITED", message: "Too many requests. Slow down and retry shortly." } },
          {
            status,
            headers: {
              "x-aegis-request-id": requestId,
              "retry-after": String(retryAfterSeconds),
              "x-ratelimit-limit": String(rateLimit.limit),
              "x-ratelimit-remaining": String(rateLimit.remaining),
            },
          }
        );
      }

      const response = await handler(
        request,
        {
          organization,
          apiKey,
          requestId,
          setAgentId: (id) => {
            agentId = id;
          },
        },
        routeContext
      );
      status = response.status;
      response.headers.set("x-aegis-request-id", requestId);
      return response;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : (mapAuthError(error) ?? null);

      if (!apiError) {
        console.error(JSON.stringify({ msg: "api_unhandled_error", endpoint, requestId, error: String(error) }));
        status = 500;
        return apiErrorResponse(new ApiError("INTERNAL_ERROR", "An unexpected error occurred.", 500), requestId);
      }

      status = apiError.status;
      return apiErrorResponse(apiError, requestId);
    } finally {
      logApiRequest({ endpoint, requestId, apiKeyId, apiKeyPrefix, organizationId, agentId, status, latencyMs: Date.now() - startedAt });
    }
  };
}
