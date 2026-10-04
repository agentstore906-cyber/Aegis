/**
 * GET /api/search — the session boundary, with the session modules mocked so the route's own
 * 401 / 403 / 200 / 503 behavior is exercised. (Tenant isolation and role gating live in the
 * service and are tested against the database in ui-search.integration.test.ts.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state: { user: { id: string } | null; membership: { organization: { id: string }; role: string } | null; failService: boolean } = {
  user: null,
  membership: null,
  failService: false,
};

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/organizations/queries", () => ({ getActiveMembership: async () => state.membership }));
vi.mock("@/lib/search/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/search/service")>();
  return { ...original, searchWorkspace: async (...args: Parameters<typeof original.searchWorkspace>) => (state.failService ? Promise.reject(new Error("db down")) : original.searchWorkspace(...args)) };
});

import { prisma } from "@/lib/db";
import { GET } from "@/app/api/search/route";
import { makeAgent } from "@/lib/control/__tests__/fixtures";

const RUN_ID = `test_search_route_${Date.now()}`;
const TOKEN = `rt${Date.now().toString(36)}`;
let org: { id: string };
let other: { id: string };

const get = (q: string) => GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "R A", slug: `${RUN_ID}-a`, plan: "enterprise" } });
  other = await prisma.organization.create({ data: { name: "R B", slug: `${RUN_ID}-b`, plan: "enterprise" } });
  await makeAgent(org.id, { slug: `${TOKEN}-mine` });
  await makeAgent(other.id, { slug: `${TOKEN}-theirs` });
});
beforeEach(() => {
  state.user = { id: "u1" };
  state.membership = { organization: { id: org.id }, role: "VIEWER" };
  state.failService = false;
});
afterAll(async () => {
  await prisma.agent.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, other.id] } } });
  await prisma.$disconnect();
});

describe("GET /api/search", () => {
  it("is 401 JSON (never a redirect to an HTML page) without a session", async () => {
    state.user = null;
    const response = await get(TOKEN);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Not signed in." });
  });

  it("is 403 for a signed-in user with no organization", async () => {
    state.membership = null;
    expect((await get(TOKEN)).status).toBe(403);
  });

  it("returns the active organization's results only, uncached", async () => {
    const response = await get(TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { groups: { type: string; results: { href: string }[] }[] };
    const titles = body.groups.flatMap((g) => g.results.map((r) => r.href));
    expect(titles.some((t) => t.includes("-mine"))).toBe(true);
    expect(titles.some((t) => t.includes("-theirs"))).toBe(false);
  });

  it("takes the organization from the membership, never from a query parameter", async () => {
    const response = await GET(new Request(`http://localhost/api/search?q=${TOKEN}&organizationId=${other.id}`));
    const text = await response.text();
    expect(text).not.toContain("-theirs");
  });

  it("says the search is unavailable (503) when it fails, rather than returning a partial list as if complete", async () => {
    state.failService = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(TOKEN);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Search is unavailable right now." });
    spy.mockRestore();
  });
});
