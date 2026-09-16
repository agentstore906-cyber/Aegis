import "server-only";

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * A bare `fetch` to a third-party API (OpenAI, Anthropic) can hang far
 * longer than a user will wait during a "Connecting..." screen. Every
 * connector call goes through this so a slow/unreachable provider fails
 * fast and predictably instead of leaving the Server Action hanging.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
