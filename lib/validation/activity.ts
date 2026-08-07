import { z } from "zod";

export const ACTIVITY_STATUSES = ["ALLOWED", "BLOCKED", "APPROVAL_REQUIRED", "FAILED"] as const;
export const ACTIVITY_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const ACTIVITY_RANGES = ["24h", "7d", "30d", "all"] as const;

export const activityFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  agentId: z.string().trim().min(1).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  riskLevel: z.enum(ACTIVITY_RISK_LEVELS).optional(),
  range: z.enum(ACTIVITY_RANGES).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});

export type ActivityFiltersInput = z.infer<typeof activityFiltersSchema>;
