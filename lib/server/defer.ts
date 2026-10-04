import "server-only";

import { after } from "next/server";

/**
 * Runs non-critical side effects (webhook delivery, post-decision
 * detectors, alert notifications) AFTER the response is sent, so they can
 * never delay or fail the security decision a caller is waiting on.
 *
 * Inside a request (Route Handler, Server Action, Server Component) this is
 * Next.js 16's `after()` — on Vercel it runs via waitUntil, bounded by the
 * route's maxDuration (node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/after.md). Outside a request scope (`after` throws — tests,
 * scripts) the task starts immediately and is tracked so callers can
 * `drainDeferredTasks()` deterministically.
 *
 * Durability is unchanged from before this helper existed: best-effort, not
 * a durable queue. A process killed mid-task loses that task (see
 * docs/AEGIS_P0_IMPLEMENTATION.md §9). Errors are logged, never thrown —
 * a side effect must not break the flow that scheduled it.
 */
const inFlight = new Set<Promise<void>>();

export function defer(label: string, task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(JSON.stringify({ msg: "deferred_task_failed", label, error: String(error) }));
    }
  };

  try {
    after(run);
    return;
  } catch {
    // Not inside a request scope — fall through to tracked immediate execution.
  }

  const promise: Promise<void> = run().finally(() => {
    inFlight.delete(promise);
  });
  inFlight.add(promise);
}

/** Awaits every task started outside a request scope (including tasks those tasks defer). Tests and scripts only. */
export async function drainDeferredTasks(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}
