import { z } from "zod";

export const CONNECTOR_TYPES = ["OPENAI", "ANTHROPIC", "CUSTOM_SDK"] as const;

export const discoverConnectionSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  credential: z.string().trim().min(1).max(400).optional(),
});
export type DiscoverConnectionInput = z.infer<typeof discoverConnectionSchema>;

export const connectAgentSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  credential: z.string().trim().min(1).max(400).optional(),
  selectedExternalId: z.string().trim().min(1).max(200).optional(),
  agentName: z.string().trim().min(2).max(80).optional(),
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT"]).optional(),
});
export type ConnectAgentInput = z.infer<typeof connectAgentSchema>;

export const reconnectAgentSchema = z.object({
  credential: z.string().trim().min(1).max(400).optional(),
});
export type ReconnectAgentInput = z.infer<typeof reconnectAgentSchema>;
