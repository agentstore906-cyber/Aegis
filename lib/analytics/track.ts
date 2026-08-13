export type AnalyticsEvent =
  | "landing_cta_clicked"
  | "signup_started"
  | "signup_completed"
  | "workspace_created"
  | "onboarding_started"
  | "demo_opened"
  | "agent_connection_started"
  | "agent_connected"
  | "api_key_created"
  | "policy_created"
  | "approval_created"
  | "approval_resolved"
  | "first_event_received"
  | "subscription_started";

type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

/**
 * A structured, provider-agnostic hook for conversion-funnel events. No
 * analytics provider is wired up yet — this only logs in development so
 * every conversion point is easy to find and wire to a real provider
 * (PostHog, Segment, etc.) later. Safe to call from Server Actions, Server
 * Components, and Client Components alike. Never pass secrets (passwords,
 * API keys, tokens) as properties.
 */
export function trackEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[analytics] ${event}`, properties ?? {});
  }
}
