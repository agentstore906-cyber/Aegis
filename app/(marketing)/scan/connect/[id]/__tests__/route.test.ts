import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  viewer: { sessionHash: "hash-a" as string | null, userId: null as string | null, organizationIds: [] as string[] },
  lookup: { status: "ok", scan: { id: "AAAAAAAAAAAAAAAAAAAAAA", userId: null as string | null } } as { status: string; scan?: { id: string; userId: string | null } },
  membership: null as null | { organization: { id: string } },
  claim: vi.fn(async () => ["AAAAAAAAAAAAAAAAAAAAAA"]),
  track: vi.fn(async () => {}),
}));

vi.mock("@/lib/scanner/http", () => ({ resolveViewer: async () => m.viewer }));
vi.mock("@/lib/scanner/service", () => ({ getScanForViewer: async () => m.lookup, claimScansForSession: m.claim }));
vi.mock("@/lib/scanner/analytics", () => ({ trackScannerEvent: m.track }));
vi.mock("@/lib/organizations/queries", () => ({ getActiveMembership: async () => m.membership }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: async () => ({ createdAt: new Date() }) } } }));

import { GET } from "@/app/(marketing)/scan/connect/[id]/route";

const call = (id = "AAAAAAAAAAAAAAAAAAAAAA") => GET(new NextRequest(`http://localhost:3000/scan/connect/${id}`), { params: Promise.resolve({ id }) });
const where = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;

beforeEach(() => {
  m.viewer = { sessionHash: "hash-a", userId: null, organizationIds: [] };
  m.lookup = { status: "ok", scan: { id: "AAAAAAAAAAAAAAAAAAAAAA", userId: null } };
  m.membership = null;
  m.claim.mockClear();
  m.track.mockClear();
});

describe("GET /scan/connect/:id — signup transition and scan preservation", () => {
  it("sends a signed-out visitor to sign-up without putting any scan data in the URL", async () => {
    const res = await call();
    expect(res.status).toBe(307);
    expect(where(res)).toBe("/sign-up?from=scan");
    expect(m.track).toHaveBeenCalledWith("connect_aegis_clicked", expect.anything());
    expect(m.track).toHaveBeenCalledWith("signup_started", expect.objectContaining({ properties: { from: "scan" } }));
    expect(m.claim).not.toHaveBeenCalled(); // claimed after sign-in, in the dashboard layout, via the browser session
  });

  it("sends a signed-in user without a workspace to onboarding", async () => {
    m.viewer.userId = "u1";
    expect(where(await call())).toBe("/onboarding");
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("claims the scan for a signed-in user with a workspace and opens their Aegis security setup", async () => {
    m.viewer.userId = "u1";
    m.membership = { organization: { id: "o1" } };
    const res = await call();
    expect(where(res)).toBe("/risk-scan/AAAAAAAAAAAAAAAAAAAAAA");
    expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ sessionHash: "hash-a", userId: "u1", organizationId: "o1" }));
  });

  it("does not re-claim a scan that already belongs to the account", async () => {
    m.viewer.userId = "u1";
    m.membership = { organization: { id: "o1" } };
    m.lookup = { status: "ok", scan: { id: "AAAAAAAAAAAAAAAAAAAAAA", userId: "u1" } };
    expect(where(await call())).toBe("/risk-scan/AAAAAAAAAAAAAAAAAAAAAA");
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("returns a visitor who doesn't own the scan (or lost their session) to the report page's safe state", async () => {
    m.lookup = { status: "not_found" };
    expect(where(await call())).toBe("/scan/report/AAAAAAAAAAAAAAAAAAAAAA");
    expect(m.track).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("encodes the id so a crafted value cannot alter the redirect target", async () => {
    m.lookup = { status: "not_found" };
    const res = await call("../../evil?x=1");
    expect(where(res)).not.toContain("evil?x=1");
    expect(new URL(res.headers.get("location")!).host).toBe("localhost:3000");
  });
});
