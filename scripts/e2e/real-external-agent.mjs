/**
 * A REAL external AI agent endpoint implementing aegis-agent/1 (docs/AEGIS_AGENT_ENDPOINT_PROTOCOL.md), for verifying
 * Connect Agent and the Free Risk Scanner end to end. It is a separate OS process (or, in tests, a real listening HTTP
 * server) that knows nothing about Aegis internals: it holds a shared secret, its own agent id and a tool manifest, and
 * answers only requests that carry a valid signature, exactly as a customer's agent must.
 *
 * It also serves as the reference for implementing the protocol in an agent (about 60 lines, no dependencies).
 *
 *   PORT, AEGIS_SECRET (required, 16+ chars), AGENT_NAME, AGENT_ID, AGENT_HUMAN_APPROVAL=true|false
 *   AGENT_INSECURE_SKIP_SIGNATURE=true   a deliberately BAD agent that answers unsigned requests (to prove the scanner finds it)
 *   AGENT_INSECURE_ACCEPT_STALE=true     a deliberately BAD agent that accepts old signed requests (replay)
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const PROTOCOL = "aegis-agent/1";
const MAX_SKEW_MS = 5 * 60 * 1000;
const hmac = (secret, data) => createHmac("sha256", secret).update(data).digest("hex");
const equal = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function startExternalAgent(options = {}) {
  const secret = options.secret ?? process.env.AEGIS_SECRET;
  if (!secret || secret.length < 16) throw new Error("AEGIS_SECRET (16+ characters) is required");
  const name = options.name ?? process.env.AGENT_NAME ?? "Reference Support Agent";
  const id = options.id ?? process.env.AGENT_ID ?? `agent_${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
  const insecureSkipSignature = options.insecureSkipSignature ?? process.env.AGENT_INSECURE_SKIP_SIGNATURE === "true";
  const insecureAcceptStale = options.insecureAcceptStale ?? process.env.AGENT_INSECURE_ACCEPT_STALE === "true";
  const manifest = "manifest" in options ? options.manifest : {
    framework: "reference-node-agent",
    model: "none (reference implementation)",
    tools: [
      { name: "crm.lookup", access: "read" },
      { name: "crm.update", access: "write" },
      { name: "files.delete", access: "destructive" },
      { name: "calendar.sync" }, // no declared access level: the scanner must list it as not assessed
    ],
    humanApproval: (options.humanApproval ?? process.env.AGENT_HUMAN_APPROVAL) === "true" || options.humanApproval === true,
  };
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));

  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 8 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const reply = (status, payload, extra = {}) => {
        log({ at: new Date().toISOString(), method: req.method, path: req.url, status, ...extra });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method !== "POST" || !req.url?.startsWith("/aegis")) return reply(404, { error: "not_found" });

      const timestamp = String(req.headers["x-aegis-timestamp"] ?? "");
      const signature = String(req.headers["x-aegis-signature"] ?? "");
      const fresh = /^\d+$/.test(timestamp) && Math.abs(Date.now() - Number(timestamp)) <= MAX_SKEW_MS;
      const valid = signature.startsWith("v1=") && equal(signature, `v1=${hmac(secret, `${timestamp}.${body}`)}`);
      const authorized = insecureSkipSignature || (valid && (fresh || insecureAcceptStale));
      if (!authorized) return reply(401, { error: "invalid_signature" }, { signed: Boolean(signature), valid, fresh });

      let request;
      try {
        request = JSON.parse(body);
      } catch {
        return reply(400, { error: "bad_json" });
      }
      if (request.protocol !== PROTOCOL || !["verify", "describe"].includes(request.op) || typeof request.challenge !== "string" || request.challenge.length < 16) {
        return reply(400, { error: "bad_request" });
      }
      const describe = request.op === "describe";
      const manifestDigest = describe ? createHash("sha256").update(JSON.stringify(manifest)).digest("hex") : "";
      const proof = hmac(secret, `${PROTOCOL}:${request.op}:${request.challenge}:${id}:${manifestDigest}`);
      return reply(200, { protocol: PROTOCOL, agent: { id, name }, proof, ...(describe && manifest ? { manifest } : {}) }, { op: request.op });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? Number(process.env.PORT ?? 0), options.host ?? "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ id, name, port, url: `http://127.0.0.1:${port}/aegis`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const agent = await startExternalAgent();
  console.log(JSON.stringify({ ready: true, id: agent.id, name: agent.name, url: agent.url }));
}
