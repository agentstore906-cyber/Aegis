import "server-only";

import type { RiskControlMode } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { isRiskControlGloballyDisabled, validateRiskControlConfig, type RiskControlConfig } from "@/lib/risk/control";

/**
 * An organization's risk-control configuration. Reads and writes are always
 * scoped to the caller's organizationId. Every change is an audit event with
 * the before/after values — turning enforcement on or off never deletes or
 * rewrites any evidence (evaluations are append-only).
 */

export type RiskControlSettings = RiskControlConfig & { globallyDisabled: boolean };

export async function getRiskControlSettings(organizationId: string): Promise<RiskControlSettings | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { riskControlMode: true, riskMediumAction: true, riskHighAction: true },
  });
  if (!org) return null;
  return {
    mode: org.riskControlMode,
    mediumAction: org.riskMediumAction,
    highAction: org.riskHighAction,
    globallyDisabled: isRiskControlGloballyDisabled(),
  };
}

export type UpdateRiskControlResult =
  | { ok: true; before: RiskControlConfig; after: RiskControlConfig; changed: boolean }
  | { ok: false; error: string };

export async function updateRiskControlSettings(params: {
  organizationId: string;
  actorUserId: string;
  next: RiskControlConfig;
  /** Required to move from OBSERVE to a mode that can change decisions. */
  confirmedEnforcement: boolean;
  /** Recorded in the audit event, e.g. "emergency_disable". */
  action?: string;
}): Promise<UpdateRiskControlResult> {
  const { organizationId, actorUserId, next } = params;
  const invalid = validateRiskControlConfig(next);
  if (invalid) return { ok: false, error: invalid };

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { riskControlMode: true, riskMediumAction: true, riskHighAction: true },
    });
    if (!org) return { ok: false as const, error: "Organization not found." };
    const before: RiskControlConfig = { mode: org.riskControlMode, mediumAction: org.riskMediumAction, highAction: org.riskHighAction };

    const enabling = before.mode === "OBSERVE" && next.mode !== "OBSERVE";
    if (enabling && !params.confirmedEnforcement) {
      return { ok: false as const, error: "Confirm that you understand risk control will change which actions are allowed before enabling it." };
    }

    const changed = before.mode !== next.mode || before.mediumAction !== next.mediumAction || before.highAction !== next.highAction;
    if (changed) {
      await tx.organization.update({
        where: { id: organizationId },
        data: { riskControlMode: next.mode, riskMediumAction: next.mediumAction, riskHighAction: next.highAction },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorType: "USER",
        actorUserId,
        eventType: AUDIT_EVENT_TYPES.RISK_CONTROL_CONFIG_UPDATED,
        entityType: "Organization",
        entityId: organizationId,
        action: params.action ?? "risk_control.update",
        metadata: { before, after: next },
      });
    }
    return { ok: true as const, before, after: next, changed };
  });
}

/** Emergency stop: back to OBSERVE, keeping the configured mapping. Idempotent; erases nothing. */
export async function disableRiskControl(organizationId: string, actorUserId: string): Promise<UpdateRiskControlResult> {
  const current = await getRiskControlSettings(organizationId);
  if (!current) return { ok: false, error: "Organization not found." };
  const mode: RiskControlMode = "OBSERVE";
  return updateRiskControlSettings({
    organizationId,
    actorUserId,
    next: { mode, mediumAction: current.mediumAction, highAction: current.highAction },
    confirmedEnforcement: true,
    action: "risk_control.emergency_disable",
  });
}
