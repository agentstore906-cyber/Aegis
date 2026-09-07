"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
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

const PaddleCheckoutContext = createContext<{
  openCheckoutForPlan: (planId: string) => Promise<OpenCheckoutResult>;
} | null>(null);

/** Loaded once per page — every BillingUpgradeButton inside this provider shares it. */
export function PaddleCheckoutProvider({ children }: { children: React.ReactNode }) {
  const [scriptReady, setScriptReady] = useState(false);
  const initialized = useRef<Promise<void> | null>(null);

  const ensureInitialized = useCallback(async (): Promise<void> => {
    if (!initialized.current) {
      initialized.current = (async () => {
        const response = await fetch("/api/billing/config");
        if (!response.ok) throw new Error("Paddle is not configured in this environment.");
        const { clientToken, environment } = (await response.json()) as {
          clientToken: string;
          environment: "sandbox" | "production";
        };

        if (!window.Paddle) throw new Error("Paddle.js failed to load.");
        if (environment === "sandbox") window.Paddle.Environment.set("sandbox");
        window.Paddle.Initialize({ token: clientToken });
      })();
    }
    return initialized.current;
  }, []);

  const openCheckoutForPlan = useCallback(
    async (planId: string): Promise<OpenCheckoutResult> => {
      const result = await createCheckoutSessionAction(planId);
      if (result.error || !result.checkout) {
        return { error: result.error ?? "Could not start checkout." };
      }

      try {
        if (!scriptReady) throw new Error("Paddle.js hasn't finished loading yet — please try again.");
        await ensureInitialized();
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not start checkout." };
      }

      const { priceId, customerId, customData } = result.checkout;
      window.Paddle!.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { id: customerId },
        customData,
        settings: {
          successUrl: `${window.location.origin}/settings/billing?checkout=success`,
          displayMode: "overlay",
        },
      });
      return {};
    },
    [scriptReady, ensureInitialized]
  );

  return (
    <PaddleCheckoutContext.Provider value={{ openCheckoutForPlan }}>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="lazyOnload"
        onLoad={() => setScriptReady(true)}
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
