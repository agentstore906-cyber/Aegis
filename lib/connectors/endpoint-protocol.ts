import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * aegis-agent/1 — how Aegis CONNECTS TO an external AI agent (docs/AEGIS_AGENT_ENDPOINT_PROTOCOL.md).
 *
 * The agent exposes one HTTPS endpoint. Aegis POSTs a JSON request signed with a secret that only Aegis and the
 * agent's owner know; the agent answers with a PROOF that only a holder of that secret can compute, bound to a fresh
 * random challenge and to the agent's own id. So a successful verification shows, at once, that:
 *   - something reachable answered at that URL, it speaks this protocol, and it holds the shared secret (it is the
 *     agent the owner configured, not just any web server);
 *   - the answer is live (the challenge was generated for this request, so it cannot be replayed);
 *   - the agent's self-declared id, which Aegis then pins.
 * Pure: no network, no database.
 */

export const PROTOCOL = "aegis-agent/1";
export type Op = "verify" | "describe";
/** The agent must refuse requests whose timestamp is further from its clock than this. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MIN_SECRET_LENGTH = 16;
export const MAX_SECRET_LENGTH = 200;

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

export const newChallenge = () => randomBytes(32).toString("base64url");

/** Header value for `x-aegis-signature`: HMAC-SHA256 over `<timestamp>.<exact request body>`. */
export function signRequest(secret: string, timestamp: string, body: string): string {
  return `v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

/** What the agent must return as `proof`. */
export function expectedProof(secret: string, op: Op, challenge: string, agentId: string, manifestDigest = ""): string {
  return hmacHex(secret, `${PROTOCOL}:${op}:${challenge}:${agentId}:${manifestDigest}`);
}

/** Digest of the manifest as the agent sent it, so the proof also covers what the scan will read. */
export const manifestDigest = (manifest: unknown): string => createHash("sha256").update(JSON.stringify(manifest ?? null)).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type ToolAccess = "read" | "write" | "destructive";
export type AgentManifest = {
  framework: string | null;
  model: string | null;
  tools: { name: string; access: ToolAccess | null }[];
  /** True/false only if the agent declared it; null = not declared. */
  humanApproval: boolean | null;
};

export type VerifiedAgent = { id: string; name: string; manifest: AgentManifest | null };

export type ParseFailure = { ok: false; code: "NOT_AGENT" | "BAD_PROOF"; message: string };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);

/** Validates an agent's response to `op` for the challenge Aegis sent. Never trusts any field before the proof checks out. */
export function parseAgentResponse(secret: string, op: Op, challenge: string, json: unknown): { ok: true; agent: VerifiedAgent } | ParseFailure {
  const notAgent = (message: string): ParseFailure => ({ ok: false, code: "NOT_AGENT", message });
  if (!json || typeof json !== "object") return notAgent("The endpoint did not answer in the aegis-agent/1 format.");
  const r = json as Record<string, unknown>;
  if (r.protocol !== PROTOCOL) return notAgent("The endpoint answered, but it does not speak aegis-agent/1, so it is not an Aegis-connectable agent.");
  const agent = r.agent && typeof r.agent === "object" ? (r.agent as Record<string, unknown>) : null;
  const id = str(agent?.id, 200);
  const name = str(agent?.name, 80);
  if (!id || !name) return notAgent("The endpoint did not identify itself (an agent needs an id and a name).");
  if (typeof r.proof !== "string") return { ok: false, code: "BAD_PROOF", message: "The endpoint did not prove it holds the shared secret." };

  const manifestRaw = op === "describe" ? r.manifest : undefined;
  const proof = expectedProof(secret, op, challenge, id, op === "describe" ? manifestDigest(manifestRaw) : "");
  if (!safeEqualHex(proof, r.proof)) {
    return { ok: false, code: "BAD_PROOF", message: "The endpoint's proof did not match. Check the shared secret; it must be the same value configured in the agent." };
  }
  return { ok: true, agent: { id, name, manifest: op === "describe" ? parseManifest(manifestRaw) : null } };
}

const ACCESS = new Set(["read", "write", "destructive"]);

export function parseManifest(raw: unknown): AgentManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const tools = Array.isArray(m.tools)
    ? m.tools.slice(0, 100).flatMap((t) => {
        if (!t || typeof t !== "object") return [];
        const o = t as Record<string, unknown>;
        const name = str(o.name, 80);
        if (!name) return [];
        return [{ name, access: typeof o.access === "string" && ACCESS.has(o.access) ? (o.access as ToolAccess) : null }];
      })
    : [];
  return {
    framework: str(m.framework, 60),
    model: str(m.model, 80),
    tools,
    humanApproval: typeof m.humanApproval === "boolean" ? m.humanApproval : null,
  };
}

/** Normalizes an endpoint URL for storage and uniqueness: no credentials/fragment, lowercase host, no trailing "/" on the path. */
export function normalizeEndpointUrl(raw: string): { ok: true; url: URL; normalized: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "Enter the agent's full endpoint URL, for example https://agent.example.com/aegis." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "The endpoint must be an http(s) URL." };
  if (url.username || url.password) return { ok: false, message: "Don't put credentials in the URL. The shared secret is entered separately." };
  if (url.search) return { ok: false, message: "Remove the query string from the URL." };
  url.hash = "";
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const normalized = `${url.protocol}//${url.host}${path === "/" ? "" : path}`;
  if (normalized.length > 300) return { ok: false, message: "That URL is too long." };
  return { ok: true, url: new URL(normalized), normalized };
}
