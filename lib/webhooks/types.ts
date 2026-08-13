export const WEBHOOK_EVENT_TYPES = [
  "security.alert.created",
  "security.alert.resolved",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "cost.anomaly.detected",
  "agent.paused",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
