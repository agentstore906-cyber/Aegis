export type ExternalAgentOptions = {
  secret?: string;
  name?: string;
  id?: string;
  port?: number;
  host?: string;
  insecureSkipSignature?: boolean;
  insecureAcceptStale?: boolean;
  humanApproval?: boolean;
  manifest?: unknown;
  log?: (line: Record<string, unknown>) => void;
};
export function startExternalAgent(options?: ExternalAgentOptions): Promise<{ id: string; name: string; port: number; url: string; close: () => Promise<void> }>;
