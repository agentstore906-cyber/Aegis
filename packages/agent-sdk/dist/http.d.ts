type RequestOptions = {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    idempotencyKey?: string;
};
/**
 * Thin fetch wrapper: per-request timeout, bounded retry with backoff on
 * transient failures only (429 / 5xx / network), and typed errors for
 * everything else. Client (4xx other than 429) errors are never retried —
 * retrying a malformed request just repeats the same failure.
 */
export declare class HttpClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly maxRetries;
    constructor(apiKey: string, baseUrl: string, timeoutMs: number, maxRetries: number);
    request<T>(options: RequestOptions): Promise<T>;
    private isRetryable;
    private backoffDelayMs;
    private attempt;
}
export {};
//# sourceMappingURL=http.d.ts.map