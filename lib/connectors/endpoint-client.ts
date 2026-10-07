import "server-only";

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPrivateOrReservedIp } from "@/lib/webhooks/ssrf";
import {
  PROTOCOL,
  newChallenge,
  normalizeEndpointUrl,
  parseAgentResponse,
  signRequest,
  type Op,
  type VerifiedAgent,
} from "@/lib/connectors/endpoint-protocol";

/**
 * Aegis's outbound side of aegis-agent/1. This is the one place where Aegis makes a request to an address a customer
 * typed, so it is deliberately strict:
 *   - https only, and the host must resolve to PUBLIC addresses only (no loopback, private, link-local, CGNAT, …);
 *   - the address that was validated is the address that is connected to (DNS answers can change between "check" and
 *     "use"), with TLS verified against the original host name;
 *   - redirects are never followed; the response is size- and time-limited and must be JSON;
 *   - the secret only ever leaves Aegis as an HMAC signature, never in the request.
 * Self-hosted deployments whose agents live on a private network opt in explicitly with
 * AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS=true (never honoured on Vercel production).
 */

export type EndpointFailureCode =
  | "UNSAFE_URL"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "TLS_ERROR"
  | "REDIRECTED"
  | "AUTH_REJECTED"
  | "NOT_AGENT"
  | "BAD_PROOF"
  | "BAD_RESPONSE";

export class EndpointError extends Error {
  constructor(
    readonly code: EndpointFailureCode,
    message: string
  ) {
    super(message);
    this.name = "EndpointError";
  }
}

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export const privateEndpointsAllowed = () => process.env.AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS === "true" && process.env.VERCEL_ENV !== "production";

type Target = { url: URL; address: string; family: 4 | 6 };

async function resolveSafeTarget(rawUrl: string): Promise<Target> {
  const normalized = normalizeEndpointUrl(rawUrl);
  if (!normalized.ok) throw new EndpointError("UNSAFE_URL", normalized.message);
  const { url } = normalized;
  const allowPrivate = privateEndpointsAllowed();
  if (url.protocol !== "https:" && !allowPrivate) throw new EndpointError("UNSAFE_URL", "The endpoint must use HTTPS.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new EndpointError("UNREACHABLE", "Aegis could not resolve that host name.");
    }
  }
  if (addresses.length === 0) throw new EndpointError("UNREACHABLE", "Aegis could not resolve that host name.");
  if (!allowPrivate && addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new EndpointError("UNSAFE_URL", "That address is private or reserved. Aegis only connects to agents on public addresses.");
  }
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

type RawResponse = { status: number; contentType: string; text: string };

function send(target: Target, headers: Record<string, string>, body: string): Promise<RawResponse> {
  const { url, address, family } = target;
  const isHttps = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        method: "POST",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname || "/",
        headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), accept: "application/json", "user-agent": "Aegis-Agent-Connector/1" },
        // Connect to the address that was validated, not whatever the name resolves to now.
        lookup: (_host: string, options: unknown, cb: (...args: unknown[]) => void) => {
          if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
        timeout: TIMEOUT_MS,
        agent: false,
      } as never,
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new EndpointError("BAD_RESPONSE", "The endpoint's response was too large."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, contentType, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new EndpointError("TIMEOUT", "The agent did not answer in time.")));
    req.on("error", (e: Error & { code?: string }) => {
      if (e instanceof EndpointError) return reject(e);
      const c = e.code ?? "";
      if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(c) || /certificate|tls/i.test(e.message)) {
        return reject(new EndpointError("TLS_ERROR", "The agent's TLS certificate could not be verified."));
      }
      if (c === "ECONNREFUSED") return reject(new EndpointError("UNREACHABLE", "Nothing is listening at that address (connection refused)."));
      if (c === "ECONNRESET" || c === "EPIPE") return reject(new EndpointError("UNREACHABLE", "The connection was closed before the agent answered."));
      if (c === "ETIMEDOUT" || c === "EHOSTUNREACH" || c === "ENETUNREACH") return reject(new EndpointError("UNREACHABLE", "Aegis could not reach that address."));
      reject(new EndpointError("UNREACHABLE", "Aegis could not connect to that address."));
    });
    req.end(body);
  });
}

function signedHeaders(secret: string, body: string, timestamp = String(Date.now())) {
  return { "x-aegis-protocol": PROTOCOL, "x-aegis-timestamp": timestamp, "x-aegis-signature": signRequest(secret, timestamp, body) };
}

function interpret(res: RawResponse): unknown {
  if (res.status >= 300 && res.status < 400) throw new EndpointError("REDIRECTED", "The endpoint redirected. Aegis does not follow redirects; enter the final URL.");
  if (res.status === 401 || res.status === 403) {
    throw new EndpointError("AUTH_REJECTED", "The agent rejected Aegis's signed request. The shared secret in Aegis and in the agent probably differ.");
  }
  if (res.status < 200 || res.status >= 300) throw new EndpointError("BAD_RESPONSE", `The endpoint answered with HTTP ${res.status}, so it is not behaving as an aegis-agent/1 agent.`);
  if (!/json/i.test(res.contentType)) throw new EndpointError("NOT_AGENT", "The endpoint answered, but not with JSON, so it is not an aegis-agent/1 agent.");
  try {
    return JSON.parse(res.text);
  } catch {
    throw new EndpointError("NOT_AGENT", "The endpoint answered with invalid JSON, so it is not an aegis-agent/1 agent.");
  }
}

/** A real, signed round trip to the agent. Resolves only when the agent proved it holds the secret for THIS challenge. */
export async function contactAgent(endpointUrl: string, secret: string, op: Op): Promise<VerifiedAgent & { endpointUrl: string }> {
  const target = await resolveSafeTarget(endpointUrl);
  const challenge = newChallenge();
  const body = JSON.stringify({ protocol: PROTOCOL, op, challenge });
  const res = await send(target, signedHeaders(secret, body), body);
  const json = interpret(res);
  const parsed = parseAgentResponse(secret, op, challenge, json);
  if (!parsed.ok) throw new EndpointError(parsed.code, parsed.message);
  return { ...parsed.agent, endpointUrl: `${target.url.protocol}//${target.url.host}${target.url.pathname === "/" ? "" : target.url.pathname}` };
}

export type ProbeKind = "unsigned" | "wrong_signature" | "stale_timestamp";
export type ProbeOutcome = { outcome: "rejected" | "accepted" | "inconclusive"; status: number | null; detail: string };

/**
 * Read-only security probes of the agent's endpoint. Each sends a `verify` request that a correct agent must refuse
 * (no signature / a wrong signature / a validly signed request that is too old). A probe never carries real
 * credentials, and `verify` has no side effect on the agent. "accepted" means the agent answered with agent data to a
 * request it should have refused; anything that stops us from judging is "inconclusive" (reported as Not tested).
 */
export async function probeEndpoint(endpointUrl: string, secret: string, kind: ProbeKind): Promise<ProbeOutcome> {
  try {
    const target = await resolveSafeTarget(endpointUrl);
    const body = JSON.stringify({ protocol: PROTOCOL, op: "verify", challenge: newChallenge() });
    const headers =
      kind === "unsigned"
        ? { "x-aegis-protocol": PROTOCOL }
        : kind === "wrong_signature"
          ? signedHeaders(`${secret}-not-the-secret`, body)
          : signedHeaders(secret, body, String(Date.now() - 60 * 60 * 1000));
    const res = await send(target, headers, body);
    if (res.status === 401 || res.status === 403 || res.status === 400) return { outcome: "rejected", status: res.status, detail: `refused with HTTP ${res.status}` };
    if (res.status >= 200 && res.status < 300) {
      let looksLikeAgent = false;
      try {
        const j = JSON.parse(res.text) as { protocol?: unknown; agent?: unknown; proof?: unknown };
        looksLikeAgent = j.protocol === PROTOCOL && Boolean(j.agent || j.proof);
      } catch {
        /* not JSON */
      }
      return looksLikeAgent
        ? { outcome: "accepted", status: res.status, detail: "answered with agent data" }
        : { outcome: "inconclusive", status: res.status, detail: `answered HTTP ${res.status} without agent data` };
    }
    return { outcome: "inconclusive", status: res.status, detail: `answered HTTP ${res.status}` };
  } catch (error) {
    return { outcome: "inconclusive", status: null, detail: error instanceof EndpointError ? error.message : "the probe could not be sent" };
  }
}
