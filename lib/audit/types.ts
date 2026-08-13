import type { AuditActorType, AuditResult } from "@prisma/client";

/**
 * Canonical event type strings recorded to AuditEvent.eventType. Kept as a
 * flat const map (not a Prisma enum) so new event types don't require a
 * migration — the audit trail is meant to grow as more of the app is
 * instrumented, without schema churn every time.
 */
export const AUDIT_EVENT_TYPES = {
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_APPROVED: "approval.approved",
  APPROVAL_REJECTED: "approval.rejected",
  APPROVAL_EXPIRED: "approval.expired",
  APPROVAL_CANCELLED: "approval.cancelled",
  POLICY_CREATED: "policy.created",
  POLICY_UPDATED: "policy.updated",
  POLICY_ENABLED: "policy.enabled",
  POLICY_DISABLED: "policy.disabled",
  POLICY_DELETED: "policy.deleted",
  PERMISSION_CREATED: "permission.created",
  PERMISSION_UPDATED: "permission.updated",
  PERMISSION_DELETED: "permission.deleted",
  AGENT_CREATED: "agent.created",
  AGENT_UPDATED: "agent.updated",
  AGENT_PAUSED: "agent.paused",
  AGENT_RESUMED: "agent.resumed",
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  SECURITY_ALERT_CREATED: "security_alert.created",
  SECURITY_ALERT_ACKNOWLEDGED: "security_alert.acknowledged",
  SECURITY_ALERT_RESOLVED: "security_alert.resolved",
  TEAM_CREATED: "team.created",
  TEAM_DELETED: "team.deleted",
  WEBHOOK_ENDPOINT_CREATED: "webhook_endpoint.created",
  WEBHOOK_ENDPOINT_DELETED: "webhook_endpoint.deleted",
  MEMBER_INVITED: "member.invited",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  MEMBER_REMOVED: "member.removed",
  ORGANIZATION_SETTINGS_UPDATED: "organization.settings_updated",
  BILLING_PLAN_CHANGED: "billing.plan_changed",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

export type RecordAuditEventInput = {
  organizationId: string;
  actorType: AuditActorType;
  actorUserId?: string | null;
  agentId?: string | null;
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  action: string;
  result?: AuditResult;
  /** Structured detail only — never include secrets, tokens, or credentials. */
  metadata?: Record<string, unknown>;
  traceId?: string | null;
};
