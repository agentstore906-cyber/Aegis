import { z } from "zod";

export const AGENT_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const AGENT_ENVIRONMENTS = ["PRODUCTION", "STAGING", "DEVELOPMENT"] as const;
export const AGENT_STATUSES = ["ACTIVE", "PAUSED", "NEEDS_ATTENTION", "ARCHIVED"] as const;

export const createAgentSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  owner: z.string().trim().min(1, "Owner / team is required").max(80),
  teamId: z.string().trim().max(60).optional().or(z.literal("")),
  environment: z.enum(AGENT_ENVIRONMENTS),
  modelProvider: z.string().trim().min(1, "Model provider is required").max(60),
  modelName: z.string().trim().min(1, "Model is required").max(60),
  riskLevel: z.enum(AGENT_RISK_LEVELS),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = createAgentSchema;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const agentFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(AGENT_STATUSES).optional(),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AgentFiltersInput = z.infer<typeof agentFiltersSchema>;
