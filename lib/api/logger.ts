/**
 * One structured line per external API request. Deliberately narrow: an
 * API key's id/prefix are safe to log, the raw key never is. Context/
 * metadata payloads are never logged here either — only routing and
 * outcome metadata.
 */
export function logApiRequest(entry: {
  endpoint: string;
  requestId: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  organizationId?: string;
  agentId?: string;
  status: number;
  latencyMs: number;
}): void {
  console.log(JSON.stringify({ msg: "api_request", at: new Date().toISOString(), ...entry }));
}
