import { z } from "zod";

export const AUDIT_RESULTS = ["SUCCESS", "FAILURE"] as const;
export const AUDIT_RANGES = ["24h", "7d", "30d", "all"] as const;

export const auditFiltersSchema = z.object({
  eventType: z.string().trim().max(60).optional(),
  actorUserId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  range: z.enum(AUDIT_RANGES).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AuditFiltersInput = z.infer<typeof auditFiltersSchema>;
