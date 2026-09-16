import { z } from "zod";

export const ACTIVITY_STATUSES = ["ALLOWED", "BLOCKED", "APPROVAL_REQUIRED", "FAILED", "WARNING"] as const;
export const ACTIVITY_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const ACTIVITY_RANGES = ["24h", "7d", "30d", "all"] as const;
export const ACTIVITY_EVENT_TYPES = [
  "TOOL_CALL",
  "MODEL_CALL",
  "DATA_ACCESS",
  "ACTION",
  "DEPLOYMENT",
  "COMMUNICATION",
  "FINANCIAL",
  "SYSTEM",
] as const;

export const activityFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  agentId: z.string().trim().min(1).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  riskLevel: z.enum(ACTIVITY_RISK_LEVELS).optional(),
  eventType: z.enum(ACTIVITY_EVENT_TYPES).optional(),
  toolName: z.string().trim().min(1).max(60).optional(),
  range: z.enum(ACTIVITY_RANGES).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});

export type ActivityFiltersInput = z.infer<typeof activityFiltersSchema>;
