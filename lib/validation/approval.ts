import { z } from "zod";
import { AGENT_RISK_LEVELS } from "@/lib/validation/agent";

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

export const approvalFiltersSchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  agentId: z.string().trim().min(1).optional(),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ApprovalFiltersInput = z.infer<typeof approvalFiltersSchema>;

export const approvalDecisionSchema = z.object({
  comment: z.string().trim().max(500, "Comment must be 500 characters or fewer").optional().or(z.literal("")),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
