import "server-only";

import { Prisma } from "@prisma/client";

/**
 * Activity events that are the evidence behind records Aegis promises to keep. Retention never deletes them.
 *
 * Product policy (docs/retention.md): security alerts and incidents are retained, and an incident's timeline is rebuilt
 * from the activity events of its run (lib/incidents/evidence.ts), so those events are retained with them. An event is
 * protected when ANY of these holds (always within the same organization and agent):
 *  - it belongs to the run (trace) of an incident, or IS an incident's anchor event;
 *  - it is the event an incident's anchor policy evaluation points at;
 *  - it belongs to the run of a security alert, or of one of that alert's occurrences.
 * The set is bounded by the number of alerts/incidents, which are themselves kept.
 *
 * This is a SQL predicate on the event alias `e` so it can be used both to choose rows and — re-evaluated inside the
 * DELETE statement itself — to guarantee that an incident or alert created between choosing and deleting is respected.
 */
export const EVIDENCE_PROTECTED: Prisma.Sql = Prisma.sql`(
  EXISTS (
    SELECT 1 FROM "incidents" i
     WHERE i."organizationId" = e."organizationId" AND i."agentId" = e."agentId"
       AND ((i."traceId" IS NOT NULL AND i."traceId" = e."traceId")
         OR (i."anchorType" = 'ACTIVITY_EVENT' AND i."anchorId" = e."id")))
  OR EXISTS (
    SELECT 1 FROM "incidents" i
      JOIN "policy_evaluations" pe ON pe."id" = i."anchorId" AND pe."organizationId" = i."organizationId"
     WHERE i."organizationId" = e."organizationId" AND i."anchorType" = 'POLICY_EVALUATION' AND pe."activityEventId" = e."id")
  OR EXISTS (
    SELECT 1 FROM "security_alerts" a
     WHERE a."organizationId" = e."organizationId" AND a."agentId" = e."agentId"
       AND a."traceId" IS NOT NULL AND a."traceId" = e."traceId")
  OR EXISTS (
    SELECT 1 FROM "security_alerts" a
      JOIN "security_alert_occurrences" o ON o."alertId" = a."id"
     WHERE a."organizationId" = e."organizationId" AND a."agentId" = e."agentId"
       AND o."traceId" IS NOT NULL AND o."traceId" = e."traceId")
)`;
