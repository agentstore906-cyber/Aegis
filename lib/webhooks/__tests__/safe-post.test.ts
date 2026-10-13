import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { lookupMock, httpsRequestMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), httpsRequestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
// HTTPS is mocked so the pinning can be inspected without any network; the real-server tests below use plain http.
vi.mock("node:https", () => ({ request: httpsRequestMock }));

import { postWebhook, MAX_WEBHOOK_RESPONSE_BYTES } from "@/lib/webhooks/safe-post";
import { assertSafeWebhookUrl, isPrivateOrReservedIp, resolveSafeWebhookTarget, UnsafeWebhookUrlError } from "@/lib/webhooks/ssrf";

afterEach(() => {
  lookupMock.mockReset();
  httpsRequestMock.mockReset();
  vi.unstubAllEnvs();
});

describe("isPrivateOrReservedIp — IPv4", () => {
  it.each([
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "100.64.0.1", "100.100.100.200", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "255.255.255.255",
  ])("blocks %s", (ip) => expect(isPrivateOrReservedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1"])("allows public %s", (ip) =>
    expect(isPrivateOrReservedIp(ip)).toBe(false)
  );
});

describe("isPrivateOrReservedIp — IPv6", () => {
  it.each([
    "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "fe80::1%eth0", "febf::1", "fc00::1", "fd00:ec2::254", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::127.0.0.1",
    "64:ff9b:1::1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "2001::1", "2001:db8::1", "100::1",
  ])("blocks %s", (ip) => expect(isPrivateOrReservedIp(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"])("allows public %s", (ip) =>
    expect(isPrivateOrReservedIp(ip)).toBe(false)
  );

  it("fails closed on anything that is not a valid IP", () => {
    for (const bad of ["", "localhost", "1.2.3", "1.2.3.4.5", "::g", "1:2:3:4:5:6:7:8:9", "example.com"]) expect(isPrivateOrReservedIp(bad)).toBe(true);
  });
});

describe("resolveSafeWebhookTarget — what is rejected before any connection", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)", "data:text/plain,hi"]) {
      await expect(resolveSafeWebhookTarget(url)).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    }
  });

  it("rejects embedded credentials (the misleading-host trick https://public@internal/)", async () => {
    await expect(resolveSafeWebhookTarget("https://8.8.8.8@127.0.0.1/hook")).rejects.toThrow(/username or password/);
    await expect(resolveSafeWebhookTarget("https://user:pass@example.com/")).rejects.toThrow(/username or password/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects metadata and private literals in every encoding the URL parser normalizes", async () => {
    vi.stubEnv("NODE_ENV", "production"); // outside production, literal loopback is the deliberate developer carve-out
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://2130706433/", // decimal 127.0.0.1
      "https://0x7f.0.0.1/",
      "https://0177.0.0.1/", // octal
      "https://127.1/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
      "https://[fd00:ec2::254]/",
      "https://[64:ff9b::a9fe:a9fe]/",
    ]) {
      await expect(resolveSafeWebhookTarget(url), url).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    }
  });

  it("rejects a public-looking hostname that RESOLVES to an internal address", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.1.2.3", "::1", "::ffff:7f00:1"]) {
      lookupMock.mockResolvedValueOnce([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(resolveSafeWebhookTarget("https://localhost.evil.example/hook"), address).rejects.toThrow(/private or reserved/);
    }
  });

  it("rejects when ANY resolved address is internal (a mixed answer cannot slip through)", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    await expect(resolveSafeWebhookTarget("https://mixed.example/hook")).rejects.toThrow(/private or reserved/);
  });

  it("rejects unresolvable hosts and empty answers", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(resolveSafeWebhookTarget("https://nope.example/")).rejects.toThrow(/Could not resolve/);
    lookupMock.mockResolvedValueOnce([]);
    await expect(resolveSafeWebhookTarget("https://empty.example/")).rejects.toThrow(/Could not resolve/);
  });

  it("in production the localhost carve-out does not exist (http or https)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveSafeWebhookTarget("http://localhost:3000/hook")).rejects.toThrow(/HTTPS/);
    await expect(resolveSafeWebhookTarget("http://127.0.0.1/hook")).rejects.toThrow(/HTTPS/);
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(resolveSafeWebhookTarget("https://localhost/hook")).rejects.toThrow(/private or reserved/);
    await expect(resolveSafeWebhookTarget("https://[::1]/hook")).rejects.toThrow(/private or reserved/);
  });

  it("returns the validated address for a public host (this is what the connection is pinned to)", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const target = await resolveSafeWebhookTarget("https://hooks.example/path?x=1");
    expect(target).toMatchObject({ address: "93.184.216.34", family: 4 });
    expect(target.url.search).toBe("?x=1");
  });

  it("assertSafeWebhookUrl (used at endpoint creation) applies the same rules", async () => {
    await expect(assertSafeWebhookUrl("https://169.254.169.254/")).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(assertSafeWebhookUrl("https://8.8.8.8/hook")).resolves.toBeUndefined();
  });
});

describe("postWebhook — against real local servers (dev loopback carve-out)", () => {
  let main: Server;
  let victim: Server;
  let mainPort: number;
  let victimPort: number;
  let victimHits = 0;
  let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("ok");

  beforeAll(async () => {
    victim = createServer((_req, res) => {
      victimHits += 1;
      res.end("INTERNAL SECRET");
    });
    main = createServer((req, res) => handler(req, res));
    await Promise.all([victim, main].map((s) => new Promise<void>((r) => s.listen(0, "127.0.0.1", r))));
    victimPort = (victim.address() as AddressInfo).port;
    mainPort = (main.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await Promise.all([victim, main].map((s) => new Promise((r) => { s.close(r); s.closeAllConnections(); })));
  });

  const post = (path = "/hook", timeoutMs = 2000) => postWebhook(`http://127.0.0.1:${mainPort}${path}`, { "Content-Type": "application/json", "X-Aegis-Event": "t" }, '{"a":1}', timeoutMs);

  it("delivers the body and headers and returns the status", async () => {
    let seen: { method?: string; url?: string; ct?: string; ev?: string; body: string } = { body: "" };
    handler = (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = { method: req.method, url: req.url, ct: String(req.headers["content-type"]), ev: String(req.headers["x-aegis-event"]), body };
        res.statusCode = 204;
        res.end();
      });
    };
    await expect(post("/hook?x=1")).resolves.toEqual({ status: 204 });
    expect(seen).toEqual({ method: "POST", url: "/hook?x=1", ct: "application/json", ev: "t", body: '{"a":1}' });
  });

  it("REGRESSION (H2): a 302 redirect to an internal service is NOT followed", async () => {
    victimHits = 0;
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", `http://127.0.0.1:${victimPort}/admin`);
      res.end();
    };
    await expect(post()).resolves.toEqual({ status: 302 });
    expect(victimHits).toBe(0);
  });

  it("does not follow 301/303/307/308 either", async () => {
    victimHits = 0;
    for (const status of [301, 303, 307, 308]) {
      handler = (_req, res) => {
        res.statusCode = status;
        res.setHeader("Location", `http://127.0.0.1:${victimPort}/`);
        res.end();
      };
      await expect(post()).resolves.toEqual({ status });
    }
    expect(victimHits).toBe(0);
  });

  it("an overall deadline ends a receiver that sends headers but never finishes, or never answers", async () => {
    handler = () => {
      /* never respond */
    };
    const started = Date.now();
    await expect(post("/hook", 300)).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a slow-drip response cannot hold the delivery past the status (headers settle it immediately)", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.write("x");
      const t = setInterval(() => res.write("x"), 50);
      res.on("close", () => clearInterval(t));
    };
    const started = Date.now();
    await expect(post()).resolves.toEqual({ status: 200 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("an oversized response body is cut off, not buffered", async () => {
    let closedEarly = false;
    handler = (_req, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(16 * 1024, 1);
      let sent = 0;
      const t = setInterval(() => {
        if (res.destroyed) return;
        res.write(chunk);
        sent += chunk.length;
        if (sent > MAX_WEBHOOK_RESPONSE_BYTES * 20) {
          clearInterval(t);
          res.end();
        }
      }, 1);
      res.on("close", () => {
        closedEarly = sent < MAX_WEBHOOK_RESPONSE_BYTES * 20;
        clearInterval(t);
      });
    };
    await expect(post()).resolves.toEqual({ status: 200 });
    await new Promise((r) => setTimeout(r, 200));
    expect(closedEarly).toBe(true);
  });

  it("a connection error is reported as an error, not a status", async () => {
    await expect(postWebhook("http://127.0.0.1:1/hook", {}, "{}", 1000)).rejects.toBeInstanceOf(Error);
  });
});

describe("postWebhook — DNS rebinding: the connection goes to the validated address, never to a second lookup", () => {
  const fakeRequest = () => Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });

  it("passes a lookup override that always answers with the address that passed validation", async () => {
    httpsRequestMock.mockImplementation(() => fakeRequest());
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    // The fake request never answers, so the deadline ends it; we only inspect how it was configured.
    await expect(postWebhook("https://rebind.example/hook", {}, "{}", 50)).rejects.toThrow(/timed out/);
    const options = httpsRequestMock.mock.calls[0]![0] as { hostname: string; lookup: (...a: unknown[]) => void };
    expect(options.hostname).toBe("rebind.example"); // SNI / certificate checks still use the real name
    // Whatever the name would resolve to now (say an attacker flipped it to 127.0.0.1), the socket gets the validated address.
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const answers: unknown[][] = [];
    options.lookup("rebind.example", {}, (...a: unknown[]) => answers.push(a));
    options.lookup("rebind.example", { all: true }, (...a: unknown[]) => answers.push(a));
    expect(answers[0]).toEqual([null, "93.184.216.34", 4]);
    expect(answers[1]).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    expect(lookupMock).toHaveBeenCalledTimes(1); // validated once; nothing re-resolves at connect time
  });

  it("makes no connection at all when validation fails", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(postWebhook("https://metadata.evil.example/", {}, "{}", 1000)).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});
