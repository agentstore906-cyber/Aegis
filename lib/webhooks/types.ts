export const WEBHOOK_EVENT_TYPES = [
  "security.alert.created",
  "security.alert.resolved",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "cost.anomaly.detected",
  "agent.paused",
  "agent.resumed",
  "agent.stopped",
  "agent.connected",
  "agent.reconnected",
  "agent.disconnected",
  "budget.exceeded",
  "budget.warning",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
