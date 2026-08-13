import {
  AegisApiError,
  AegisAuthenticationError,
  AegisNetworkError,
  AegisRateLimitError,
  AegisTimeoutError,
  AegisValidationError,
} from "./errors.js";

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

type ApiErrorBody = { error?: { code?: string; message?: string } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

/**
 * Thin fetch wrapper: per-request timeout, bounded retry with backoff on
 * transient failures only (429 / 5xx / network), and typed errors for
 * everything else. Client (4xx other than 429) errors are never retried —
 * retrying a malformed request just repeats the same failure.
 */
export class HttpClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly maxRetries: number
  ) {}

  async request<T>(options: RequestOptions): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        return await this.attempt<T>(options);
      } catch (error) {
        if (attempt > this.maxRetries || !this.isRetryable(error)) throw error;
        await sleep(this.backoffDelayMs(attempt, error));
      }
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof AegisRateLimitError) return true;
    if (error instanceof AegisNetworkError) return true;
    if (error instanceof AegisApiError) return error.status >= 500;
    return false;
  }

  private backoffDelayMs(attempt: number, error: unknown): number {
    if (error instanceof AegisRateLimitError && error.retryAfterSeconds) {
      return error.retryAfterSeconds * 1000;
    }
    const base = 300 * 2 ** (attempt - 1);
    const jitter = Math.random() * 100;
    return Math.min(base + jitter, 5000);
  }

  private async attempt<T>(options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AegisTimeoutError(`Request to ${options.path} timed out after ${this.timeoutMs}ms.`);
      }
      throw new AegisNetworkError(`Network error calling ${options.path}.`, error);
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get("x-aegis-request-id") ?? undefined;

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      throw new AegisRateLimitError(
        "Rate limit exceeded. Slow down and retry shortly.",
        retryAfterHeader ? Number(retryAfterHeader) : undefined,
        requestId
      );
    }

    if (!response.ok) {
      const errorBody = await safeJson(response);
      const code = errorBody?.error?.code ?? "UNKNOWN_ERROR";
      const message = errorBody?.error?.message ?? `Request to ${options.path} failed with status ${response.status}.`;

      if (response.status === 401) throw new AegisAuthenticationError(message, requestId);
      if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 413) {
        throw new AegisValidationError(message, code, requestId);
      }
      throw new AegisApiError(message, code, response.status, requestId);
    }

    return (await response.json()) as T;
  }
}
