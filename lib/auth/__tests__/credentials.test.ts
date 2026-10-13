import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, verifyPassword } = vi.hoisted(() => ({ findUnique: vi.fn(), verifyPassword: vi.fn() }));

// next-auth cannot load under Vitest (it imports "next/server" without an extension); only the error base class is needed.
vi.mock("next-auth", () => ({ CredentialsSignin: class CredentialsSignin extends Error { code = "credentials" } }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth/password", () => ({ verifyPassword }));

import { authorizeCredentials } from "@/lib/auth/credentials";
import { SignInRateLimitedError, signInIpEmailLimiter, signInIpLimiter } from "@/lib/auth/sign-in-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip-headers";

// The deployment under test is Vercel: the platform-set header is the trusted source (see lib/http/client-ip-headers.ts).
const req = (ip: string) => ({ headers: new Headers({ "x-vercel-forwarded-for": ip }) });
const USER = { id: "u1", name: "A", email: "a@example.com", image: null, passwordHash: "hash" };

// Each test uses its own IP/email so the shared in-memory buckets never collide.
let n = 0;
let ip: string;
beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("AEGIS_TRUSTED_PROXY_HOPS", "");
  findUnique.mockReset();
  verifyPassword.mockReset();
  n += 1;
  ip = `203.0.113.${n}`;
});

describe("sign-in throttling at the authorization boundary (H1)", () => {
  it("the limiter backend in tests is the in-memory one (RATE_LIMIT_BACKEND unset, NODE_ENV=test)", () => {
    expect(signInIpLimiter.constructor.name).toBe("InMemoryRateLimiter");
  });

  it("REGRESSION: calling authorize directly (as POST /api/auth/callback/credentials does) is throttled per IP+email", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < 8; i += 1) {
      await expect(authorizeCredentials({ email: "a@example.com", password: "wrong" }, req(ip))).resolves.toBeNull();
    }
    await expect(authorizeCredentials({ email: "a@example.com", password: "wrong" }, req(ip))).rejects.toBeInstanceOf(SignInRateLimitedError);
    // The password was not even checked once blocked: no bcrypt work for throttled requests.
    expect(verifyPassword).toHaveBeenCalledTimes(8);
  });

  it("blocks even the CORRECT password once the limit is hit (no oracle after lockout)", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < 8; i += 1) await authorizeCredentials({ email: "a@example.com", password: "wrong" }, req(ip));
    verifyPassword.mockResolvedValue(true);
    await expect(authorizeCredentials({ email: "a@example.com", password: "right" }, req(ip))).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("normal sign-in works and returns only public user fields", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(true);
    const user = await authorizeCredentials({ email: "A@Example.com", password: "right" }, req(ip));
    expect(user).toEqual({ id: "u1", name: "A", email: "a@example.com", image: null });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "a@example.com" } });
  });

  it("an attacker's attempts from one IP do not lock the victim out from another IP (no email-only bucket)", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < 9; i += 1) await authorizeCredentials({ email: "a@example.com", password: "x" }, req(ip)).catch(() => null);
    verifyPassword.mockResolvedValue(true);
    await expect(authorizeCredentials({ email: "a@example.com", password: "right" }, req(`198.51.100.${n}`))).resolves.toMatchObject({ id: "u1" });
  });

  it("changing the email's case/whitespace does not mint a fresh bucket", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    const variants = ["a@example.com", "A@EXAMPLE.COM", " a@example.com", "a@example.com ", "A@example.com", "a@Example.com", "a@example.COM", "  A@example.com  "];
    for (const email of variants) await authorizeCredentials({ email, password: "x" }, req(ip));
    await expect(authorizeCredentials({ email: "a@example.com", password: "x" }, req(ip))).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("rotating the email on one IP is capped by the per-IP bucket", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i += 1) await authorizeCredentials({ email: `user${i}@example.com`, password: "x" }, req(ip));
    await expect(authorizeCredentials({ email: "another@example.com", password: "x" }, req(ip))).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("malformed or missing input is throttled BEFORE parsing, never reaches the database, and does not throw other errors", async () => {
    for (let i = 0; i < 8; i += 1) {
      await expect(authorizeCredentials({ email: { evil: true }, password: 123 } as never, req(ip))).resolves.toBeNull();
    }
    await expect(authorizeCredentials(undefined, req(ip))).rejects.toBeInstanceOf(SignInRateLimitedError);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("a missing request (no headers) still goes through a limiter instead of skipping it", async () => {
    findUnique.mockResolvedValue(null);
    const results = [];
    for (let i = 0; i < 9; i += 1) results.push(await authorizeCredentials({ email: "nobody@example.com", password: "x" }, undefined).catch((e) => e));
    expect(results.some((r) => r instanceof SignInRateLimitedError)).toBe(true);
  });

  it("unknown email and wrong password are indistinguishable (both null)", async () => {
    findUnique.mockResolvedValueOnce(null);
    const a = await authorizeCredentials({ email: "ghost@example.com", password: "x" }, req(ip));
    findUnique.mockResolvedValueOnce(USER);
    verifyPassword.mockResolvedValueOnce(false);
    const b = await authorizeCredentials({ email: "a@example.com", password: "x" }, req(ip));
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it("the thrown error carries only a generic code (it is placed in a redirect URL)", () => {
    const e = new SignInRateLimitedError();
    expect(e.code).toBe("rate_limited");
    expect(String(e.message)).not.toMatch(/@|password/i);
  });

  it("limiter keys never contain the raw email", async () => {
    const spy = vi.spyOn(signInIpEmailLimiter, "consume");
    await authorizeCredentials({ email: "secret.person@example.com", password: "x" }, req(ip));
    expect(String(spy.mock.calls[0]![0])).not.toContain("secret.person");
    spy.mockRestore();
  });
});

describe("M3: a spoofed X-Forwarded-For cannot mint new buckets", () => {
  const spoofed = (trueIp: string, forged: string) => ({
    headers: new Headers({ "x-vercel-forwarded-for": trueIp, "x-forwarded-for": `${forged}, ${trueIp}`, "x-real-ip": forged }),
  });

  it("REGRESSION (Vercel): rotating forged X-Forwarded-For / X-Real-IP with a constant true source is still limited per IP+email", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < 8; i += 1) await authorizeCredentials({ email: "a@example.com", password: "x" }, spoofed(ip, `192.0.2.${i + 1}`));
    await expect(authorizeCredentials({ email: "a@example.com", password: "x" }, spoofed(ip, "192.0.2.99"))).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("REGRESSION (Vercel): rotating forged addresses while rotating emails is still capped by the per-IP bucket", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i += 1) await authorizeCredentials({ email: `u${i}@example.com`, password: "x" }, spoofed(ip, `192.0.2.${i + 1}`));
    await expect(authorizeCredentials({ email: "z@example.com", password: "x" }, spoofed(ip, "192.0.2.200"))).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("REGRESSION (no trusted source configured): forwarding headers are ignored, so rotating them cannot evade the per-account limit", async () => {
    vi.stubEnv("VERCEL", "");
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    const email = `victim${n}@example.com`;
    for (let i = 0; i < 8; i += 1) await authorizeCredentials({ email, password: "x" }, { headers: new Headers({ "x-forwarded-for": `192.0.2.${i + 1}` }) });
    await expect(authorizeCredentials({ email, password: "x" }, { headers: new Headers({ "x-forwarded-for": "192.0.2.250" }) })).rejects.toBeInstanceOf(SignInRateLimitedError);
  });

  it("no trusted source: the shared 'unknown' key uses the coarse flood ceiling, so a few attempts do not lock out everyone", async () => {
    vi.stubEnv("VERCEL", "");
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 40; i += 1) await expect(authorizeCredentials({ email: `anon${n}-${i}@example.com`, password: "x" }, { headers: new Headers() })).resolves.toBeNull();
  });

  it("proxy-depth mode: only the N-th entry from the right counts, however the client rotates the left side", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("AEGIS_TRUSTED_PROXY_HOPS", "1");
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    const email = `hops${n}@example.com`;
    for (let i = 0; i < 8; i += 1) await authorizeCredentials({ email, password: "x" }, { headers: new Headers({ "x-forwarded-for": `198.18.${i}.1, ${ip}` }) });
    await expect(authorizeCredentials({ email, password: "x" }, { headers: new Headers({ "x-forwarded-for": `198.18.99.1, ${ip}` }) })).rejects.toBeInstanceOf(SignInRateLimitedError);
    // A different real client (different rightmost entry) is unaffected.
    verifyPassword.mockResolvedValue(true);
    await expect(authorizeCredentials({ email, password: "right" }, { headers: new Headers({ "x-forwarded-for": `198.18.0.1, 198.51.100.${n}` }) })).resolves.toMatchObject({ id: "u1" });
  });
});

describe("M3 follow-ups: sign-in with mapped IPv6, and with no trustworthy IP", () => {
  it("REGRESSION: one IPv4 client reported as IPv4 and as IPv4-mapped IPv6 shares ONE bucket, and other clients are not merged into it", async () => {
    findUnique.mockResolvedValue(USER);
    verifyPassword.mockResolvedValue(false);
    const email = `mapped${n}@example.com`;
    const forms = ["198.51.100.20", "::ffff:198.51.100.20", "::ffff:c633:6414", "198.51.100.20:5555"];
    for (let i = 0; i < 8; i += 1) await authorizeCredentials({ email, password: "x" }, req(forms[i % forms.length]!));
    await expect(authorizeCredentials({ email, password: "x" }, req("::ffff:198.51.100.20"))).rejects.toBeInstanceOf(SignInRateLimitedError);
    // a different IPv4 client in mapped form is a different client
    await expect(authorizeCredentials({ email, password: "x" }, req("::ffff:198.51.100.21"))).resolves.toBeNull();
  });

  it("no trustworthy IP: the per-IP buckets are never used, so no one can exhaust a shared bucket to block everybody", async () => {
    vi.stubEnv("VERCEL", "");
    findUnique.mockResolvedValue(null);
    const ipSpy = vi.spyOn(signInIpLimiter, "consume");
    for (let i = 0; i < 400; i += 1) {
      await expect(authorizeCredentials({ email: `flood${n}-${i}@example.com`, password: "x" }, { headers: new Headers({ "x-forwarded-for": `192.0.2.${i % 250}` }) })).resolves.toBeNull();
    }
    expect(ipSpy).not.toHaveBeenCalled();
    await expect(authorizeCredentials({ email: `legit${n}@example.com`, password: "x" }, { headers: new Headers() })).resolves.toBeNull();
    ipSpy.mockRestore();
  });

  it("no trustworthy IP: malformed / missing email is not rate limited and never reaches the database", async () => {
    vi.stubEnv("VERCEL", "");
    for (let i = 0; i < 30; i += 1) {
      await expect(authorizeCredentials({ email: i % 2 ? undefined : "garbage", password: "x" }, { headers: new Headers() })).resolves.toBeNull();
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("clientIpFromHeaders", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("never trusts X-Forwarded-For / X-Real-IP on their own", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), {})).toBe("unknown");
    expect(clientIpFromHeaders(h({}), {})).toBe("unknown");
  });

  it("Vercel: uses x-vercel-forwarded-for, then x-real-ip, and ignores X-Forwarded-For", () => {
    const env = { VERCEL: "1" };
    expect(clientIpFromHeaders(h({ "x-vercel-forwarded-for": " 1.2.3.4 ", "x-forwarded-for": "9.9.9.9" }), env)).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9" }), env)).toBe("5.6.7.8");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9" }), env)).toBe("unknown");
  });

  it("proxy-depth mode takes the N-th entry from the right and needs a long-enough chain", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), { AEGIS_TRUSTED_PROXY_HOPS: "1" })).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }), { AEGIS_TRUSTED_PROXY_HOPS: "2" })).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4" }), { AEGIS_TRUSTED_PROXY_HOPS: "2" })).toBe("unknown");
    expect(clientIpFromHeaders(h({}), { AEGIS_TRUSTED_PROXY_HOPS: "1" })).toBe("unknown");
  });

  it("an invalid hops setting or an invalid address is never trusted", () => {
    for (const bad of ["0", "-1", "abc", "1.5", "99", ""]) expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4" }), { AEGIS_TRUSTED_PROXY_HOPS: bad })).toBe("unknown");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "not-an-ip" }), { AEGIS_TRUSTED_PROXY_HOPS: "1" })).toBe("unknown");
    expect(clientIpFromHeaders(h({ "x-vercel-forwarded-for": "1.2.3.4; DROP" }), { VERCEL: "1" })).toBe("unknown");
    expect(clientIpFromHeaders(h({ "x-vercel-forwarded-for": "a".repeat(500) }), { VERCEL: "1" })).toBe("unknown");
  });

  it("IPv6 clients are bucketed by /64 so one client cannot rotate through its own prefix", () => {
    const env = { VERCEL: "1" };
    const a = clientIpFromHeaders(h({ "x-vercel-forwarded-for": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }), env);
    const b = clientIpFromHeaders(h({ "x-vercel-forwarded-for": "2001:db8:1:2::1" }), env);
    const c = clientIpFromHeaders(h({ "x-vercel-forwarded-for": "2001:db8:1:3::1" }), env);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe("2001:0db8:0001:0002::/64");
  });
});
