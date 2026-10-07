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

/** Connect an external agent that Aegis reaches over aegis-agent/1. Nothing here names an agent: the agent identifies itself. */
export const connectEndpointSchema = z.object({
  endpointUrl: z.string().trim().min(8).max(300),
  secret: z.string().min(16, "The shared secret must be at least 16 characters.").max(200),
  displayName: z.string().trim().min(2).max(80).optional(),
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT"]).optional(),
});
export type ConnectEndpointInput = z.infer<typeof connectEndpointSchema>;

export const reconnectAgentSchema = z.object({
  credential: z.string().trim().min(1).max(400).optional(),
});
export type ReconnectAgentInput = z.infer<typeof reconnectAgentSchema>;
