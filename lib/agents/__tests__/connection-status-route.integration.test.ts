/**
 * GET /api/agents/:slug/connection — session boundary, tenant isolation, and that nothing secret is returned.
 * (The state derivation itself is covered in connection-state.test.ts and agent-connection.integration.test.ts.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state: { user: { id: string } | null; membership: { organization: { id: string }; role: string } | null } = { user: null, membership: null };
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/organizations/queries", () => ({ getActiveMembership: async () => state.membership }));

import { prisma } from "@/lib/db";
import { GET } from "@/app/api/agents/[slug]/connection/route";
import { connectProviderAgent } from "@/lib/agents/connection-service";

const RUN_ID = `test_connstat_${Date.now()}`;
let org: { id: string };
let other: { id: string };
let user: { id: string };
let mine: { slug: string; key: string };
let theirs: { slug: string };

const get = (slug: string) => GET(new Request(`http://localhost/api/agents/${slug}/connection`), { params: Promise.resolve({ slug }) });

async function connect(organizationId: string, name: string) {
  const r = await connectProviderAgent({ organizationId, userId: user.id, ownerLabel: "T", connectorType: "CUSTOM_SDK", agentName: name });
  if (!r.ok || !("apiKeyRaw" in r) || !r.apiKeyRaw) throw new Error("connect failed");
  return { slug: r.agentSlug, key: r.apiKeyRaw };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "S A", slug: `${RUN_ID}-a`, plan: "enterprise" } });
  other = await prisma.organization.create({ data: { name: "S B", slug: `${RUN_ID}-b`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.test`, name: "T" } });
  mine = await connect(org.id, "Status Mine");
  theirs = await connect(other.id, "Status Theirs");
}, 60_000);
beforeEach(() => {
  state.user = { id: user.id };
  state.membership = { organization: { id: org.id }, role: "VIEWER" };
});
afterAll(async () => {
  const orgIds = [org.id, other.id];
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

describe("GET /api/agents/:slug/connection", () => {
  it("401 JSON without a session, 403 without an organization", async () => {
    state.user = null;
    const signedOut = await get(mine.slug);
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("cache-control")).toBe("no-store");
    state.user = { id: user.id };
    state.membership = null;
    expect((await get(mine.slug)).status).toBe(403);
  });

  it("reports WAITING for a fresh agent, uncached, and never includes a credential or its hash", async () => {
    const response = await get(mine.slug);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.view.state).toBe("WAITING");
    expect(text).not.toContain(mine.key);
    const hash = (await prisma.apiKey.findFirstOrThrow({ where: { organizationId: org.id } })).keyHash;
    expect(text).not.toContain(hash);
    expect(text).not.toMatch(/keyHash|credentialCiphertext|aegis_(live|test)_/);
  });

  it("is 404 for another organization's agent — the slug never crosses tenants", async () => {
    const response = await get(theirs.slug);
    expect(response.status).toBe(404);
  });
});
