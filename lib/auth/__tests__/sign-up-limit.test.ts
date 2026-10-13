import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, create, state } = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), state: { headers: new Headers() } }));

vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next-auth", () => ({ CredentialsSignin: class CredentialsSignin extends Error { code = "credentials" } }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn(async () => undefined), signOut: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique, create } } }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn(async () => "hash"), verifyPassword: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: vi.fn() }));

import { signUpAction } from "@/lib/auth/actions";

const form = (email: string) => {
  const f = new FormData();
  f.set("name", "Test");
  f.set("email", email);
  f.set("password", "correct-horse-battery");
  return f;
};
const signUp = (email: string) => signUpAction({}, form(email));
const TOO_MANY = { error: "Too many sign-up attempts. Please try again later." };

let n = 0;
beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("AEGIS_TRUSTED_PROXY_HOPS", "");
  findUnique.mockReset().mockResolvedValue(null);
  create.mockReset().mockImplementation(async ({ data }: { data: { email: string } }) => ({ id: `u-${data.email}` }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  n += 1;
});

describe("sign-up rate limiting across trust configurations", () => {
  it("trusted IP (Vercel): 5 sign-ups per hour per client, the 6th is refused, another client is unaffected", async () => {
    vi.stubEnv("VERCEL", "1");
    state.headers = new Headers({ "x-vercel-forwarded-for": `198.51.100.${n}` });
    for (let i = 0; i < 5; i += 1) expect(await signUp(`ok${n}-${i}@example.com`)).toEqual({});
    expect(await signUp(`ok${n}-6@example.com`)).toEqual(TOO_MANY);
    state.headers = new Headers({ "x-vercel-forwarded-for": `203.0.113.${n}` });
    expect(await signUp(`other${n}@example.com`)).toEqual({});
  });

  it("REGRESSION: with no trustworthy IP, many different people can still sign up (no shared 5-per-hour bucket)", async () => {
    state.headers = new Headers(); // nothing trusted
    for (let i = 0; i < 40; i += 1) expect(await signUp(`person${n}-${i}@example.com`)).toEqual({});
    expect(create).toHaveBeenCalledTimes(40);
  });

  it("REGRESSION: rotating forged X-Forwarded-For / X-Real-IP neither creates buckets nor blocks anyone, but the per-email cap still holds", async () => {
    const email = `victim${n}@example.com`;
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      state.headers = new Headers({ "x-forwarded-for": `192.0.2.${i + 1}`, "x-real-ip": `192.0.2.${i + 100}` });
      results.push(await signUp(email));
    }
    expect(results.slice(0, 3)).toEqual([{}, {}, {}]);
    expect(results[3]).toEqual(TOO_MANY);
    state.headers = new Headers({ "x-forwarded-for": "192.0.2.250" });
    expect(await signUp(`someone-else${n}@example.com`)).toEqual({});
  });

  it("an unusable email with no trusted IP is rejected by validation (no database work), not rate limited", async () => {
    state.headers = new Headers();
    for (let i = 0; i < 20; i += 1) expect(await signUp("not-an-email")).toEqual({ error: expect.stringMatching(/email/i) });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
