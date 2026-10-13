import { describe, expect, it } from "vitest";

import { clientIpFromHeaders, normalizeClientIp } from "@/lib/http/client-ip-headers";

const vercel = (value: string) => clientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": value }), { VERCEL: "1" });
const hops = (chain: string, n = "1") => clientIpFromHeaders(new Headers({ "x-forwarded-for": chain }), { AEGIS_TRUSTED_PROXY_HOPS: n });

describe("IPv4-mapped IPv6 (M3 follow-up 1)", () => {
  it.each([
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["::FFFF:1.2.3.4", "1.2.3.4"],
    ["::ffff:0102:0304", "1.2.3.4"],
    ["0:0:0:0:0:ffff:1.2.3.4", "1.2.3.4"],
    ["0000:0000:0000:0000:0000:ffff:0102:0304", "1.2.3.4"],
    ["[::ffff:1.2.3.4]", "1.2.3.4"],
    ["[::ffff:1.2.3.4]:55555", "1.2.3.4"],
  ])("%s is the same client as plain IPv4 %s", (raw, expected) => expect(normalizeClientIp(raw)).toBe(expected));

  it("every equivalent representation of one client yields ONE bucket key", () => {
    const keys = new Set(["1.2.3.4", "1.2.3.4:443", "::ffff:1.2.3.4", "::ffff:102:304", "[::ffff:1.2.3.4]:80"].map(normalizeClientIp));
    expect(keys).toEqual(new Set(["1.2.3.4"]));
  });

  it("REGRESSION: distinct IPv4 clients reported in mapped form are NOT merged into one shared bucket", () => {
    const keys = new Set(["::ffff:1.2.3.4", "::ffff:5.6.7.8", "::ffff:9.9.9.9", "::ffff:0a00:0001"].map(normalizeClientIp));
    expect(keys.size).toBe(4);
    expect(keys.has(null)).toBe(false);
    for (const key of keys) expect(key).not.toContain("::/64");
  });

  it("works through both trusted sources", () => {
    expect(vercel("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(hops("6.6.6.6, ::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("NAT64 and other embedded-IPv4 forms are NOT converted", () => {
  it.each(["64:ff9b::1.2.3.4", "64:ff9b::5.6.7.8", "64:ff9b::0102:0304", "64:ff9b:1::1", "::1.2.3.4", "::0102:0304"])(
    "%s is rejected (unknown), never merged into a shared /64 or mis-attributed to an IPv4 client",
    (raw) => {
      expect(normalizeClientIp(raw)).toBeNull();
      expect(vercel(raw)).toBe("unknown");
    }
  );

  it("loopback and unspecified addresses keep a stable key (local development)", () => {
    expect(normalizeClientIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeClientIp("::")).toBe("0000:0000:0000:0000::/64");
  });
});

describe("IPv6 privacy-address grouping is preserved", () => {
  it("clients in one /64 share a bucket; different /64s do not; case and zero-compression do not matter", () => {
    const a = normalizeClientIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(normalizeClientIp("2001:DB8:1:2::1")).toBe(a);
    expect(normalizeClientIp("2001:0db8:0001:0002:0000:0000:0000:0001")).toBe(a);
    expect(normalizeClientIp("2001:db8:1:3::1")).not.toBe(a);
  });
});

describe("port-suffixed addresses (M3 follow-up 2)", () => {
  it.each([
    ["1.2.3.4:8080", "1.2.3.4"],
    ["1.2.3.4:1", "1.2.3.4"],
    ["1.2.3.4:65535", "1.2.3.4"],
    [" 1.2.3.4:443 ", "1.2.3.4"],
    ["[2001:db8::1]:51234", "2001:0db8:0000:0000::/64"],
    ["[2001:db8::1]", "2001:0db8:0000:0000::/64"],
    ["[fe80::1%eth0]:80", "fe80:0000:0000:0000::/64"],
  ])("accepts %s", (raw, expected) => expect(normalizeClientIp(raw)).toBe(expected));

  it("the source port never changes the bucket (otherwise one client would get a bucket per connection)", () => {
    expect(new Set(["1.2.3.4:1000", "1.2.3.4:2000", "1.2.3.4:65000", "1.2.3.4"].map(normalizeClientIp)).size).toBe(1);
  });

  it.each([
    "1.2.3.4:0", "1.2.3.4:65536", "1.2.3.4:99999", "1.2.3.4:", "1.2.3.4:abc", "1.2.3.4:80:80", "1.2.3.4 :80", "1.2.3.4:-1",
    "[2001:db8::1]:0", "[2001:db8::1]:70000", "[2001:db8::1", "2001:db8::1]", "[1.2.3.4]", "[1.2.3.4]:80", "[::ffff:1.2.3.4]:x",
    "example.com", "example.com:80", "localhost", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.4/24", "1.2.3.4,5.6.7.8", "1.2.3.4;x", "",
    "for=1.2.3.4", "unknown", "_hidden", "0x7f.0.0.1", "a".repeat(100),
  ])("rejects %j", (raw) => expect(normalizeClientIp(raw)).toBeNull());

  it("an unbracketed IPv6 address is never split into address and port", () => {
    expect(normalizeClientIp("2001:db8::1:8080")).toBe("2001:0db8:0000:0000::/64"); // a plain address whose last group is 8080
    expect(normalizeClientIp("2001:db8::8080")).toBe("2001:0db8:0000:0000::/64");
  });

  it("ports are accepted from trusted sources only; untrusted headers are still ignored", () => {
    expect(vercel("1.2.3.4:51234")).toBe("1.2.3.4");
    expect(hops("6.6.6.6, 1.2.3.4:51234")).toBe("1.2.3.4");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4:51234", "x-real-ip": "5.6.7.8" }), {})).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4:51234" }), { AEGIS_TRUSTED_PROXY_HOPS: "" })).toBe("unknown");
  });

  it("hostnames and garbage from a trusted header yield unknown, never a private bucket", () => {
    for (const bad of ["evil.example", "evil.example:80", "<script>", "1.2.3.4; DROP TABLE"]) {
      expect(vercel(bad)).toBe("unknown");
      expect(hops(`1.1.1.1, ${bad}`)).toBe("unknown");
    }
  });
});
