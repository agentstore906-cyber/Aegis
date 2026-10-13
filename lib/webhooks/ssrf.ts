import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

function ipv4Octets(ip: string): number[] {
  return ip.split(".").map(Number);
}

/** RFC 1918 private ranges, loopback, link-local (incl. the 169.254.169.254 cloud metadata address), CGNAT, documentation, benchmarking, multicast, and reserved space. */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const [a, b, c] = ipv4Octets(ip);
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT; also Alibaba metadata 100.100.100.200)
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast (deprecated)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224-239), reserved (240-255), broadcast
  return false;
}

/** Parses an IPv6 literal (no brackets; an optional %zone and a trailing dotted IPv4 are accepted) into 8 16-bit groups, or null. */
function parseIpv6(ip: string): number[] | null {
  let text = ip.split("%")[0]!.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]!) !== 4) return null;
    const [a, b, c, d] = ipv4Octets(dotted[2]!);
    text = `${dotted[1]}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const parsed = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return parsed.some(Number.isNaN) ? null : parsed;
}

const v4FromGroups = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Unspecified/loopback, unique-local, link-local, site-local, multicast, documentation and every transition format that
 * embeds an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo) — the embedded address is checked against
 * the IPv4 rules, so `::ffff:7f00:1`, `64:ff9b::a9fe:a9fe` or `2002:7f00:1::` cannot smuggle a private target past a
 * dotted-form check. Fails closed on anything it cannot parse.
 */
function isPrivateOrReservedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return isPrivateOrReservedIpv4(v4FromGroups(g6, g7)); // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateOrReservedIpv4(v4FromGroups(g6, g7)); // 64:ff9b::/96 NAT64
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // 64:ff9b:1::/48 local-use NAT64
  if (g0 === 0x2002) return isPrivateOrReservedIpv4(v4FromGroups(g1, g2)); // 2002::/16 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // 2001::/32 Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard-only
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. AWS IPv6 metadata fd00:ec2::254)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Fails closed: an address family we don't recognize is treated as unsafe. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const version = isIP(bare.split("%")[0]!);
  if (version === 4) return isPrivateOrReservedIpv4(bare);
  if (version === 6) return isPrivateOrReservedIpv6(bare);
  return true;
}

const DEV_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A validated destination: connect to `address` (already checked), never to whatever the name resolves to later. */
export type SafeWebhookTarget = { url: URL; address: string; family: 4 | 6 };

/**
 * Validates a webhook destination and returns the address to connect to. HTTPS only (except a narrow localhost
 * carve-out outside production so developers can test against a local receiver), no embedded credentials, and EVERY
 * resolved address must be public — never loopback/private/link-local/metadata/multicast. Callers must connect to the
 * returned address (lib/webhooks/safe-post.ts does), which is what closes the gap between "checked" and "connected":
 * a second DNS lookup at connect time (DNS rebinding) never happens.
 * Checked at endpoint-creation time (lib/webhooks/repository.ts) and again before every delivery attempt.
 */
export async function resolveSafeWebhookTarget(rawUrl: string): Promise<SafeWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("Enter a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("Only http(s) URLs are supported.");
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError("Webhook URLs must not contain a username or password.");
  }

  const isDevLoopback = process.env.NODE_ENV !== "production" && DEV_LOOPBACK_HOSTS.has(url.hostname);

  if (url.protocol !== "https:" && !isDevLoopback) {
    throw new UnsafeWebhookUrlError("Webhook URLs must use HTTPS.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  let addresses: { address: string; family: number }[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new UnsafeWebhookUrlError("Could not resolve this host.");
    }
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError("Could not resolve this host.");
  }

  if (!isDevLoopback) {
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new UnsafeWebhookUrlError(
          "This URL resolves to a private or reserved IP address, which isn't allowed for webhooks."
        );
      }
    }
  }

  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/** Same checks as `resolveSafeWebhookTarget`, for callers that only need a yes/no (endpoint creation). */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  await resolveSafeWebhookTarget(rawUrl);
}
