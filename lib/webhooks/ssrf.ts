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

/** RFC 1918 private ranges, loopback, link-local, CGNAT, benchmarking, multicast, and reserved space. */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const [a, b, c] = ipv4Octets(ip);
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast (224-239), reserved (240-255), broadcast
  return false;
}

/** Unique-local, link-local, loopback, unspecified, and IPv4-mapped addresses (checked against the IPv4 rules above). */
function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local

  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);

  return false;
}

/** Fails closed: an address family we don't recognize is treated as unsafe. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIpv4(ip);
  if (version === 6) return isPrivateOrReservedIpv6(ip);
  return true;
}

const DEV_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Validates a webhook destination is safe to POST to: HTTPS only (except
 * an explicit, narrow localhost carve-out outside production, so
 * developers can point a webhook at a local receiver while testing), and
 * must resolve to a public IP — never a loopback/private/link-local/
 * multicast address. Checked at endpoint-creation time
 * (lib/webhooks/repository.ts) and again immediately before every
 * delivery attempt (lib/webhooks/dispatch.ts), since DNS answers can
 * change between the two.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("Enter a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("Only http(s) URLs are supported.");
  }

  const isDevLoopback = process.env.NODE_ENV !== "production" && DEV_LOOPBACK_HOSTS.has(url.hostname);

  if (url.protocol !== "https:" && !isDevLoopback) {
    throw new UnsafeWebhookUrlError("Webhook URLs must use HTTPS.");
  }

  if (isDevLoopback) return;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new UnsafeWebhookUrlError("Could not resolve this host.");
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError("Could not resolve this host.");
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new UnsafeWebhookUrlError(
        "This URL resolves to a private or reserved IP address, which isn't allowed for webhooks."
      );
    }
  }
}
