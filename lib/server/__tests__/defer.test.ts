/** P0 §9 — deferred side effects: never block, never throw into the caller. */
import { describe, expect, it, vi } from "vitest";

import { defer, drainDeferredTasks } from "@/lib/server/defer";

describe("defer (outside a request scope)", () => {
  it("returns immediately, before a slow task finishes, and drains deterministically", async () => {
    let finished = false;
    const startedAt = Date.now();
    defer("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      finished = true;
    });
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(finished).toBe(false);

    await drainDeferredTasks();
    expect(finished).toBe(true);
  });

  it("logs and swallows task errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      defer("failing", async () => {
        throw new Error("boom");
      })
    ).not.toThrow();
    await expect(drainDeferredTasks()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("deferred_task_failed"));
    errorSpy.mockRestore();
  });

  it("drains tasks that schedule further tasks", async () => {
    const order: string[] = [];
    defer("outer", async () => {
      order.push("outer");
      defer("inner", async () => {
        order.push("inner");
      });
    });
    await drainDeferredTasks();
    expect(order).toEqual(["outer", "inner"]);
  });
});
