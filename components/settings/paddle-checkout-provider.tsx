"use client";

import { createContext, useCallback, useContext, useRef } from "react";
import Script from "next/script";

import { createCheckoutSessionAction } from "@/lib/billing/actions";

/**
 * Minimal shape of the Paddle.js v2 global this file actually calls.
 * Paddle.js has no first-party TypeScript package for the browser build —
 * this is a local ambient type for the small subset used here, not a
 * full SDK surface.
 */
interface PaddleJs {
  Environment: { set(env: "sandbox" | "production"): void };
  Initialize(options: { token: string }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customer?: { id: string };
      customData?: Record<string, unknown>;
      settings?: { successUrl?: string; displayMode?: "overlay" | "inline" };
    }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

type OpenCheckoutResult = { error?: string };

const PADDLE_JS_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";
/** A Paddle price id is `pri_…`. The server already validates this; the client re-checks so a bad id fails with a logged reason, not an opaque Paddle.js throw. */
const PADDLE_PRICE_ID_PATTERN = /^pri_[a-z0-9]+$/;
/** How long to wait for Paddle.js to finish loading before giving up (it's a ~30 KB CDN script). */
const SCRIPT_READY_TIMEOUT_MS = 10_000;
const GENERIC_ERROR = "Could not start checkout. Please try again in a moment.";

/** Safe, non-sensitive description of a thrown value — never contains a token or price. */
function describeClientError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || "Error", message: error.message };
  return { name: "UnknownError", message: typeof error === "string" ? error : "Unknown error" };
}

const PaddleCheckoutContext = createContext<{
  openCheckoutForPlan: (planId: string) => Promise<OpenCheckoutResult>;
} | null>(null);

/** Loaded once per page — every BillingUpgradeButton inside this provider shares it. */
export function PaddleCheckoutProvider({ children }: { children: React.ReactNode }) {
  const scriptStateRef = useRef<"loading" | "ready" | "error">("loading");
  const initialized = useRef<Promise<void> | null>(null);

  const setScript = useCallback((next: "ready" | "error") => {
    scriptStateRef.current = next;
  }, []);

  /** Resolves once `window.Paddle` is available, rejects if the script errored or never arrived. */
  const waitForScript = useCallback(async (): Promise<void> => {
    const start = Date.now();
    for (;;) {
      const state = scriptStateRef.current;
      if (state === "ready" && window.Paddle) return;
      if (state === "error") throw new Error("Paddle.js failed to load.");
      if (Date.now() - start >= SCRIPT_READY_TIMEOUT_MS) {
        throw new Error("Paddle.js did not finish loading in time.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  const ensureInitialized = useCallback((): Promise<void> => {
    if (initialized.current) return initialized.current;

    const attempt = (async () => {
      const response = await fetch("/api/billing/config");
      if (!response.ok) throw new Error("Paddle is not configured in this environment.");
      const { clientToken, environment } = (await response.json()) as {
        clientToken: string;
        environment: "sandbox" | "production";
      };

      await waitForScript();
      if (!window.Paddle) throw new Error("Paddle.js failed to load.");

      // Set the environment explicitly in both directions: Paddle.js
      // defaults to production, so a sandbox token with no `set()` call
      // (or a production token after a prior `set("sandbox")`) makes
      // Initialize reject with an environment/token mismatch.
      window.Paddle.Environment.set(environment);
      window.Paddle.Initialize({ token: clientToken });
    })();

    // Don't leave a rejected init promise cached — a transient
    // /api/billing/config blip would otherwise wedge checkout until a full
    // page reload. Concurrent callers still share this attempt while it's
    // pending; the next call after a failure starts a fresh one.
    attempt.catch(() => {
      if (initialized.current === attempt) initialized.current = null;
    });
    initialized.current = attempt;
    return attempt;
  }, [waitForScript]);

  const openCheckoutForPlan = useCallback(
    async (planId: string): Promise<OpenCheckoutResult> => {
      const result = await createCheckoutSessionAction(planId);
      if (result.error || !result.checkout) {
        return { error: result.error ?? GENERIC_ERROR };
      }

      try {
        await ensureInitialized();
      } catch (error) {
        console.error(
          JSON.stringify({ msg: "paddle_checkout_init_failed", error: describeClientError(error) })
        );
        return {
          error:
            error instanceof Error && error.message
              ? `${error.message} Please try again in a moment.`
              : GENERIC_ERROR,
        };
      }

      const { priceId, customerId, customData } = result.checkout;
      if (!PADDLE_PRICE_ID_PATTERN.test(priceId)) {
        console.error(
          JSON.stringify({ msg: "paddle_checkout_bad_price_id", prefix: priceId.slice(0, 4) })
        );
        return { error: GENERIC_ERROR };
      }
      try {
        window.Paddle!.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: { id: customerId },
          customData,
          settings: {
            successUrl: `${window.location.origin}/settings/billing?checkout=success`,
            displayMode: "overlay",
          },
        });
      } catch (error) {
        // Capture Paddle's own error name/message (e.g. an invalid price id
        // or environment mismatch) for debugging — it carries no secret.
        console.error(
          JSON.stringify({ msg: "paddle_checkout_open_failed", error: describeClientError(error) })
        );
        return { error: GENERIC_ERROR };
      }
      return {};
    },
    [ensureInitialized]
  );

  return (
    <PaddleCheckoutContext.Provider value={{ openCheckoutForPlan }}>
      <Script
        src={PADDLE_JS_SRC}
        strategy="afterInteractive"
        onLoad={() => setScript("ready")}
        onReady={() => setScript("ready")}
        onError={() => {
          console.error(JSON.stringify({ msg: "paddle_js_load_failed", src: PADDLE_JS_SRC }));
          setScript("error");
        }}
      />
      {children}
    </PaddleCheckoutContext.Provider>
  );
}

export function usePaddleCheckout() {
  const context = useContext(PaddleCheckoutContext);
  if (!context) throw new Error("usePaddleCheckout must be used within a PaddleCheckoutProvider");
  return context;
}

export { PADDLE_JS_SRC };
