import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

/**
 * Locks in the security headers Paddle's checkout overlay actually needs.
 * Paddle.js v2 serves the overlay iframe from `buy.paddle.com` /
 * `sandbox-buy.paddle.com` and creates the checkout via
 * `create-checkout.paddle.com` — an earlier revision allowlisted
 * `checkout.paddle.com`, a host Paddle.js never contacts, so `frame-src`
 * blocked the overlay outright. This guards against that regression.
 */
async function getHeaders(): Promise<Record<string, string>> {
  const groups = await nextConfig.headers!();
  const flat: Record<string, string> = {};
  for (const group of groups) {
    for (const { key, value } of group.headers) flat[key] = value;
  }
  return flat;
}

describe("Paddle checkout security headers", () => {
  it("allows the real Paddle overlay iframe host in frame-src", async () => {
    const csp = (await getHeaders())["Content-Security-Policy"];
    expect(csp).toMatch(/frame-src[^;]*https:\/\/buy\.paddle\.com/);
    expect(csp).toMatch(/frame-src[^;]*https:\/\/sandbox-buy\.paddle\.com/);
  });

  it("allows Paddle's script CDN and browser API hosts", async () => {
    const csp = (await getHeaders())["Content-Security-Policy"];
    expect(csp).toMatch(/script-src[^;]*https:\/\/cdn\.paddle\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.paddle\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/buy\.paddle\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/create-checkout\.paddle\.com/);
  });

  it("delegates the payment Permissions-Policy to the Paddle overlay host, not a dead domain", async () => {
    const permissionsPolicy = (await getHeaders())["Permissions-Policy"];
    expect(permissionsPolicy).toContain('payment=(self "https://buy.paddle.com"');
    expect(permissionsPolicy).not.toContain("checkout.paddle.com");
  });

  it("no longer references checkout.paddle.com anywhere (Paddle.js never uses it)", async () => {
    const headers = await getHeaders();
    expect(headers["Content-Security-Policy"]).not.toContain("https://checkout.paddle.com");
  });
});
