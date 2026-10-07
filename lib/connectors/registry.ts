import "server-only";

import type { ConnectorType } from "@prisma/client";

import { openaiConnector } from "@/lib/connectors/openai";
import { anthropicConnector } from "@/lib/connectors/anthropic";
import { customConnector } from "@/lib/connectors/custom";
import { endpointConnector } from "@/lib/connectors/endpoint";
import type { AgentConnector } from "@/lib/connectors/types";

const CONNECTORS: Record<ConnectorType, AgentConnector> = {
  OPENAI: openaiConnector,
  ANTHROPIC: anthropicConnector,
  CUSTOM_SDK: customConnector,
  AEGIS_ENDPOINT: endpointConnector,
};

export function getConnector(type: ConnectorType): AgentConnector {
  return CONNECTORS[type];
}

/**
 * Every connector Aegis actually implements, in the order the "Connect an
 * Agent" screen shows them. Adding a provider here is the one line that
 * makes it appear — see docs/connect-agent.md for what implementing one
 * requires.
 */
export const SUPPORTED_CONNECTOR_TYPES: ConnectorType[] = ["OPENAI", "ANTHROPIC", "CUSTOM_SDK"];
