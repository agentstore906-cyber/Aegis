import { z } from "zod";

export const SECURITY_ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export const SECURITY_ALERT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const securityAlertFiltersSchema = z.object({
  status: z.enum(SECURITY_ALERT_STATUSES).optional(),
  severity: z.enum(SECURITY_ALERT_SEVERITIES).optional(),
  agentId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type SecurityAlertFiltersInput = z.infer<typeof securityAlertFiltersSchema>;
