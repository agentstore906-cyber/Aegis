/**
 * Aegis CONNECTS TO a real external agent (aegis-agent/1), and the Free Risk Scanner scans that same agent.
 * The "agents" here are real listening HTTP services (scripts/e2e/real-external-agent.mjs); Aegis reaches them over
 * real sockets. Nothing about a connection is written by the test — only the organizations and the agent processes.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { connectEndpointAgent } from "@/lib/agents/endpoint-connection";
import { checkConnectionHealth, connectProviderAgent, disconnectAgentConnection } from "@/lib/agents/connection-service";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { AgentNotScannableError, getLatestAgentScan, runAgentScan } from "@/lib/scanner/agent-scan";
import { listScanTargets } from "@/lib/scanner/agent-scan-targets";
import { startExternalAgent } from "../../scripts/e2e/real-external-agent.mjs";

type Running = Awaited<ReturnType<typeof startExternalAgent>>;

const RUN = `ep_${Date.now()}`;
const SECRET = "reference-agent-shared-secret-0123456789";
const quiet = () => {};

let userId: string;
let orgA: string;
let orgB: string;
const closers: (() => Promise<void>)[] = [];

async function agent(opts: Parameters<typeof startExternalAgent>[0] = {}): Promise<Running> {
  const a = await startExternalAgent({ secret: SECRET, log: quiet, ...opts });
  closers.push(a.close);
  return a;
}
function plainServer(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      closers.push(() => new Promise((r) => server.close(() => r())));
      resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/aegis`, server });
    });
  });
}
const connect = (organizationId: string, url: string, over: Record<string, unknown> = {}) =>
  connectEndpointAgent({ organizationId, userId, ownerLabel: "t", endpointUrl: url, secret: SECRET, ...over });
const counts = async (organizationId: string) => ({
  agents: await prisma.agent.count({ where: { organizationId } }),
  connections: await prisma.agentConnection.count({ where: { organizationId } }),
});
const scan = (organizationId: string, agentSlug: string) => runAgentScan({ organizationId, agentSlug, userId });
async function refused(p: Promise<unknown>) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AgentNotScannableError);
  return e as AgentNotScannableError;
}
async function ok(p: ReturnType<typeof connect>) {
  const r = await p;
  if (!r.ok) throw new Error(`connect failed: ${r.code} ${r.error}`);
  return r;
}

beforeAll(async () => {
  process.env.AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS = "true"; // the test agents listen on loopback
  userId = (await prisma.user.create({ data: { email: `${RUN}@example.com`, name: "T" } })).id;
  orgA = (await prisma.organization.create({ data: { name: "EP A", slug: `${RUN}-a`, plan: "enterprise" } })).id;
  orgB = (await prisma.organization.create({ data: { name: "EP B", slug: `${RUN}-b`, plan: "enterprise" } })).id;
}, 60_000);

afterEach(() => {
  process.env.AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS = "true";
});

afterAll(async () => {
  await Promise.all(closers.map((c) => c().catch(() => undefined)));
  await prisma.$disconnect();
});

describe("a connection that cannot be verified creates nothing", () => {
  it("an unreachable endpoint is refused with a reason, and no agent or connection exists", async () => {
    const dead = await agent();
    const url = dead.url;
    await dead.close();
    const before = await counts(orgA);
    const r = await connect(orgA, url);
    expect(r).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(await counts(orgA)).toEqual(before);
  });

  it("a web server that is not an agent (HTML) is refused", async () => {
    const web = await plainServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>hello</html>");
    });
    const before = await counts(orgA);
    expect(await connect(orgA, web.url)).toMatchObject({ ok: false, code: "NOT_AGENT" });
    expect(await counts(orgA)).toEqual(before);
  });

  it("a JSON API that does not speak aegis-agent/1 is refused", async () => {
    const api = await plainServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, agent: { id: "x", name: "pretender" } }));
    });
    expect(await connect(orgA, api.url)).toMatchObject({ ok: false, code: "NOT_AGENT" });
  });

  it("something that claims the protocol but cannot prove the shared secret is refused", async () => {
    const liar = await plainServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ protocol: "aegis-agent/1", agent: { id: "liar", name: "Liar" }, proof: "0".repeat(64) }));
    });
    const before = await counts(orgA);
    expect(await connect(orgA, liar.url)).toMatchObject({ ok: false, code: "BAD_PROOF" });
    expect(await counts(orgA)).toEqual(before);
  });

  it("a wrong shared secret is refused (the real agent rejects the signature)", async () => {
    const a = await agent();
    const before = await counts(orgA);
    expect(await connect(orgA, a.url, { secret: "a-different-secret-that-is-long-enough" })).toMatchObject({ ok: false, code: "AUTH_REJECTED" });
    expect(await counts(orgA)).toEqual(before);
  });

  it("a redirect is not followed", async () => {
    const real = await agent();
    const redirector = await plainServer((_req, res) => {
      res.writeHead(307, { location: real.url });
      res.end();
    });
    expect(await connect(orgA, redirector.url)).toMatchObject({ ok: false, code: "REDIRECTED" });
  });

  it("private addresses and plain HTTP are refused unless the operator opted in (SSRF)", async () => {
    const a = await agent();
    process.env.AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS = "false";
    const before = await counts(orgA);
    expect(await connect(orgA, a.url)).toMatchObject({ ok: false, code: "UNSAFE_URL" });
    for (const url of ["https://127.0.0.1/aegis", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/aegis", "https://[::1]/aegis", "http://example.com/aegis"]) {
      expect(await connect(orgA, url), url).toMatchObject({ ok: false, code: "UNSAFE_URL" });
    }
    expect(await connect(orgA, "https://user:pass@example.com/aegis")).toMatchObject({ ok: false, code: "INVALID" });
    expect(await connect(orgA, "not a url")).toMatchObject({ ok: false, code: "INVALID" });
    expect(await counts(orgA)).toEqual(before);
  });
});

describe("a verified connection is persisted against one real agent", () => {
  it("creates the agent only after verification, pinning the agent's own id and storing the secret encrypted", async () => {
    const a = await agent({ name: `Support ${RUN}` });
    const r = await ok(connect(orgA, a.url));
    expect(r.agentName).toBe(`Support ${RUN}`); // the name the AGENT reported, not something typed
    expect(r.reconnected).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);

    const row = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: r.agentId } });
    expect(row).toMatchObject({ organizationId: orgA, connectorType: "AEGIS_ENDPOINT", status: "CONNECTED", endpointUrl: a.url, externalAgentId: a.id });
    expect(row.lastVerifiedAt).not.toBeNull();
    expect(row.firstHandshakeAt).not.toBeNull();
    expect(row.apiKeyId).toBeNull(); // no Aegis credential is handed out: Aegis connects to the agent
    expect(row.credentialCiphertext).toBeTruthy();
    expect(row.credentialCiphertext).not.toContain(SECRET);
    expect(row.externalAccountLabel ?? "").not.toContain(SECRET);

    const snap = await getAgentConnectionSnapshot(orgA, r.agentSlug);
    expect(snap!.view.state).toBe("CONNECTED");
    expect(snap!.connectorType).toBe("AEGIS_ENDPOINT");
    expect(await prisma.auditEvent.count({ where: { agentId: r.agentId, action: "agent.connect" } })).toBe(1);
  });

  it("a typed display name is only a label: the same real agent is never connected twice", async () => {
    const a = await agent({ name: `Dup ${RUN}` });
    const first = await ok(connect(orgA, a.url, { displayName: "Name one" }));
    const second = await ok(connect(orgA, a.url, { displayName: "A totally different name" }));
    expect(second.agentId).toBe(first.agentId);
    expect(second.reconnected).toBe(true);
    expect(await prisma.agent.count({ where: { organizationId: orgA, id: first.agentId } })).toBe(1);

    // The same agent (same id) through another URL is the same identity, refused as a duplicate.
    const sameIdElsewhere = await agent({ id: a.id, name: "Same agent, other address" });
    expect(await connect(orgA, sameIdElsewhere.url)).toMatchObject({ ok: false, code: "DUPLICATE" });
  });

  it("two organizations can each connect the same endpoint: separate records, never shared", async () => {
    const a = await agent({ name: `Shared ${RUN}` });
    const inA = await ok(connect(orgA, a.url));
    const inB = await ok(connect(orgB, a.url));
    expect(inB.agentId).not.toBe(inA.agentId);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: inB.agentId } })).organizationId).toBe(orgB);
  });
});

describe("the connection stays tied to the same real agent", () => {
  it("a different agent answering at the same address is not treated as the connected one", async () => {
    const original = await agent({ id: `orig_${RUN}`, name: `Pinned ${RUN}` });
    const r = await ok(connect(orgA, original.url));
    const port = original.port;
    await original.close();
    const impostor = await agent({ id: `impostor_${RUN}`, name: `Pinned ${RUN}`, port }); // same address, same secret, different agent

    expect(await checkConnectionHealth(orgA, r.agentSlug)).toMatchObject({ ok: false });
    expect(await connect(orgA, impostor.url)).toMatchObject({ ok: false, code: "IDENTITY_CHANGED" });
    const e = await refused(scan(orgA, r.agentSlug));
    expect(e.code).toBe("NOT_CONNECTED"); // the failed verification put the connection in an error state
    expect(e.message).toMatch(/different agent/i);
    expect(await prisma.agentSecurityScan.count({ where: { agentId: r.agentId } })).toBe(0);
    // The record still points at the pinned id.
    expect((await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: r.agentId } })).externalAgentId).toBe(`orig_${RUN}`);
  });

  it("a health check really contacts the agent: it passes while the agent is up and fails once it is gone", async () => {
    const a = await agent({ name: `Health ${RUN}` });
    const r = await ok(connect(orgA, a.url));
    expect(await checkConnectionHealth(orgA, r.agentSlug)).toMatchObject({ ok: true, status: "CONNECTED" });
    await a.close();
    const down = await checkConnectionHealth(orgA, r.agentSlug);
    expect(down.ok).toBe(false);
    expect(down.error).toMatch(/connection refused|reach/i);
    expect((await getAgentConnectionSnapshot(orgA, r.agentSlug))!.view.state).toBe("ERROR");
  });
});

describe("Free Risk Scanner: the exact same real agent", () => {
  it("offers only verified endpoint agents of the organization — nothing else", async () => {
    const clean = await prisma.organization.create({ data: { name: "EP Clean", slug: `${RUN}-clean`, plan: "enterprise" } });
    expect(await listScanTargets(clean.id)).toEqual({ targets: [], notScannable: 0 });

    // An agent that Aegis did not connect to (an SDK record) is not a target, and cannot be scanned.
    const sdk = await connectProviderAgent({ organizationId: clean.id, userId, ownerLabel: "t", connectorType: "CUSTOM_SDK", agentName: `Sdk ${RUN}` });
    if (!sdk.ok) throw new Error("sdk connect failed");
    expect(await listScanTargets(clean.id)).toEqual({ targets: [], notScannable: 1 });
    const e = await refused(scan(clean.id, sdk.agentSlug));
    expect(e.code).toBe("NOT_CONNECTED");
    expect(e.message).toMatch(/connect an ai agent first/i);
    expect(e.message).not.toMatch(/waiting/i);

    const a = await agent({ name: `Target ${RUN}` });
    const r = await ok(connect(clean.id, a.url));
    const { targets, notScannable } = await listScanTargets(clean.id);
    expect(notScannable).toBe(1);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ id: r.agentId, slug: r.agentSlug, state: "CONNECTED", lastScan: null });
  });

  it("scans the exact agent that was connected: live verification, endpoint tests, declared manifest, stored against it", async () => {
    const a = await agent({ name: `Scan ${RUN}` });
    const r = await ok(connect(orgA, a.url));
    const before = (await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: r.agentId } })).lastVerifiedAt!;
    await new Promise((res) => setTimeout(res, 15));

    const { id, result } = await scan(orgA, r.agentSlug);
    const row = await prisma.agentSecurityScan.findUniqueOrThrow({ where: { id } });
    expect(row.agentId).toBe(r.agentId);
    expect(row.organizationId).toBe(orgA);
    // The scan itself re-verified the agent.
    expect((await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: r.agentId } })).lastVerifiedAt!.getTime()).toBeGreaterThan(before.getTime());

    const tests = Object.fromEntries(result.endpointTests.map((t) => [t.id, t.outcome]));
    expect(tests).toMatchObject({ unsigned_rejected: "passed", wrong_signature_rejected: "passed", stale_request_rejected: "passed" });
    // Test servers are plain HTTP (opt-in), so the TLS test honestly fails.
    expect(tests.transport_tls).toBe("failed");
    expect(result.findings.map((f) => f.id)).toContain("endpoint-not-https");
    // Declared by the agent, labelled as such, never run.
    const declared = result.findings.find((f) => f.id === "declared-destructive-tools")!;
    expect(declared.basis).toBe("observed");
    expect(declared.detail).toContain("files.delete");
    expect(declared.detail).toMatch(/did not run these tools|what the agent says about itself/i);
    // Tools without a declared access level and everything Aegis cannot see are NOT tested — never passed.
    expect(result.notTested.map((n) => n.id)).toEqual(expect.arrayContaining(["tool-access-levels", "prompts", "source-code", "model-behavior", "tool-execution"]));
    expect(Object.keys(result).sort()).toEqual(["endpointTests", "findings", "notTested", "observations", "tests"]);
    expect(JSON.stringify(result)).not.toMatch(/"score"|riskScore/i);
    expect((await getLatestAgentScan(orgA, r.agentId))?.id).toBe(id);
    expect((await listScanTargets(orgA)).targets.find((t) => t.id === r.agentId)?.lastScan?.findingCount).toBe(result.findings.length);
  });

  it("does not execute anything on the agent: it only ever receives signed verify/describe and the three refusal probes", async () => {
    const seen: Record<string, unknown>[] = [];
    const a = await agent({ name: `Quiet ${RUN}`, log: (l) => seen.push(l) });
    const r = await ok(connect(orgA, a.url));
    seen.length = 0;
    await scan(orgA, r.agentSlug);
    const ok200 = seen.filter((l) => l.status === 200).map((l) => l.op);
    expect(ok200).toEqual(["describe"]); // one signed read-only describe
    const refusedProbes = seen.filter((l) => l.status === 401);
    expect(refusedProbes).toHaveLength(3); // no signature, wrong signature, stale — all refused
    expect(seen.every((l) => l.method === "POST" && String(l.path).startsWith("/aegis"))).toBe(true);
  });

  it("finds a genuinely insecure agent: one that answers unsigned requests", async () => {
    const bad = await agent({ name: `Bad ${RUN}`, insecureSkipSignature: true });
    const r = await ok(connect(orgA, bad.url));
    const { result } = await scan(orgA, r.agentSlug);
    const f = result.findings.find((x) => x.id === "endpoint-accepts-unsigned")!;
    expect(f).toMatchObject({ severity: "high", basis: "tested" });
    expect(result.endpointTests.find((t) => t.id === "unsigned_rejected")?.outcome).toBe("failed");
  });

  it("finds an agent that accepts old signed requests (replay)", async () => {
    const bad = await agent({ name: `Replay ${RUN}`, insecureAcceptStale: true });
    const r = await ok(connect(orgA, bad.url));
    const { result } = await scan(orgA, r.agentSlug);
    expect(result.findings.find((x) => x.id === "endpoint-accepts-replay")).toMatchObject({ severity: "medium", basis: "tested" });
    expect(result.endpointTests.find((t) => t.id === "unsigned_rejected")?.outcome).toBe("passed");
  });

  it("no manifest, no claims: an agent that declares nothing leaves its tools 'not tested'", async () => {
    const a = await agent({ name: `Bare ${RUN}`, manifest: null });
    const r = await ok(connect(orgA, a.url));
    const { result } = await scan(orgA, r.agentSlug);
    expect(result.notTested.map((n) => n.id)).toContain("declared-tools");
    expect(result.findings.map((f) => f.id)).not.toContain("declared-destructive-tools");
  });

  it("an agent that cannot be reached right now is not scanned, and nothing is stored or faked", async () => {
    const a = await agent({ name: `Gone ${RUN}` });
    const r = await ok(connect(orgA, a.url));
    await a.close();
    const e = await refused(scan(orgA, r.agentSlug));
    expect(e.code).toBe("NOT_REACHABLE");
    expect(await prisma.agentSecurityScan.count({ where: { agentId: r.agentId } })).toBe(0);
    expect((await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: r.agentId } })).status).toBe("RECONNECT_REQUIRED");
    // And it can no longer be scanned from the dashboard either (state is an error until it is verified again).
    expect((await listScanTargets(orgA)).targets.map((t) => t.id)).not.toContain(r.agentId);
  });

  it("a disconnected agent is not scanned", async () => {
    const a = await agent({ name: `Off ${RUN}` });
    const r = await ok(connect(orgA, a.url));
    await disconnectAgentConnection(orgA, userId, r.agentSlug);
    expect((await refused(scan(orgA, r.agentSlug))).message).toMatch(/disconnected/i);
    expect((await listScanTargets(orgA)).targets.map((t) => t.id)).not.toContain(r.agentId);
    // Reconnecting through Connect Agent restores the SAME agent record (identity preserved).
    const again = await ok(connect(orgA, a.url));
    expect(again.agentId).toBe(r.agentId);
    await scan(orgA, r.agentSlug);
  });
});

describe("organization isolation", () => {
  it("another organization cannot scan, read, or list this organization's agent", async () => {
    const a = await agent({ name: `Private ${RUN}` });
    const mine = await ok(connect(orgA, a.url));
    const { id } = await scan(orgA, mine.agentSlug);

    expect((await refused(scan(orgB, mine.agentSlug))).code).toBe("NOT_FOUND");
    expect(await getLatestAgentScan(orgB, mine.agentId)).toBeNull();
    expect((await listScanTargets(orgB)).targets.map((t) => t.id)).not.toContain(mine.agentId);
    expect((await getLatestAgentScan(orgA, mine.agentId))?.id).toBe(id);
    // A scan row is never reachable through the other organization even by id.
    expect(await prisma.agentSecurityScan.count({ where: { id, organizationId: orgB } })).toBe(0);
  });

  it("the same slug in two organizations resolves to each organization's own agent", async () => {
    const a1 = await agent({ name: `Twin ${RUN}` });
    const a2 = await agent({ name: `Twin ${RUN}` });
    const inA = await ok(connect(orgA, a1.url));
    const inB = await ok(connect(orgB, a2.url));
    expect(inA.agentSlug.startsWith("twin")).toBe(true);
    const sA = await scan(orgA, inA.agentSlug);
    const sB = await scan(orgB, inB.agentSlug);
    expect((await prisma.agentSecurityScan.findUniqueOrThrow({ where: { id: sA.id } })).agentId).toBe(inA.agentId);
    expect((await prisma.agentSecurityScan.findUniqueOrThrow({ where: { id: sB.id } })).agentId).toBe(inB.agentId);
  });
});
