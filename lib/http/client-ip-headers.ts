import { isIP } from "node:net";

/** Returned when no trustworthy client address can be established. Callers use it as a (shared) rate-limit key. */
export const UNKNOWN_CLIENT_IP = "unknown";

type HeaderReader = Pick<Headers, "get">;
type Env = { [key: string]: string | undefined };

/** The highest proxy count accepted from `AEGIS_TRUSTED_PROXY_HOPS`; anything else is ignored (treated as not configured). */
const MAX_TRUSTED_HOPS = 5;

/**
 * Expands an IPv6 literal into 8 groups (handles `::`, a trailing dotted IPv4 and a `%zone`), or null.
 * Used only to reduce an address to its /64 so one client cannot mint endless buckets from its own prefix.
 */
function ipv6Groups(ip: string): string[] | null {
  let text = ip.split("%")[0]!.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number) as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.length === 8 ? groups.map((g) => g.padStart(4, "0")) : null;
}

const validPort = (digits: string | undefined): boolean => digits === undefined || (Number(digits) >= 1 && Number(digits) <= 65535);

/**
 * A client IP normalised for use as a rate-limit bucket key, or null when the value is not an unambiguous client address.
 *
 * Accepted shapes (only ever applied to values from a TRUSTED source, see `clientIpFromHeaders`):
 *   - `1.2.3.4`, `1.2.3.4:51234`        (some proxies, e.g. Azure Application Gateway, append the client's source port)
 *   - `2001:db8::1`, `[2001:db8::1]`, `[2001:db8::1]:51234`
 * An UNBRACKETED IPv6 address is never split into address and port (that is ambiguous); it is simply an address.
 * Hostnames, ports outside 1-65535, whitespace inside the value and anything else are rejected.
 *
 * Normalisation:
 *   - IPv4-mapped IPv6 (`::ffff:1.2.3.4`, `::ffff:102:304`) becomes the plain IPv4 address, so one client has one bucket
 *     whichever form a proxy or socket reports, and unrelated IPv4 clients are never merged into one IPv6 /64.
 *   - Other IPv6 addresses are bucketed by /64, so one client cannot mint endless buckets from its own prefix.
 *   - NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) and deprecated IPv4-compatible (`::a.b.c.d`) addresses are REJECTED (null,
 *     i.e. "unknown"): they are not addresses a client connects FROM in a direct deployment, and the embedded IPv4 is the
 *     destination or an ambiguous legacy form, so converting it could merge or misattribute unrelated clients.
 */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  let candidate = raw?.trim();
  if (!candidate || candidate.length > 64) return null;

  const bracketed = candidate.match(/^\[([^\]\s]+)\](?::(\d{1,5}))?$/);
  if (bracketed) {
    if (!validPort(bracketed[2]) || isIP(bracketed[1]!.split("%")[0]!) !== 6) return null;
    candidate = bracketed[1]!;
  } else {
    const v4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
    if (v4WithPort) {
      if (!validPort(v4WithPort[2])) return null;
      candidate = v4WithPort[1]!;
    }
  }

  const address = candidate.split("%")[0]!;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;

  const groups = ipv6Groups(address);
  if (!groups) return null;
  const zeroHead = (count: number) => groups.slice(0, count).every((g) => g === "0000");
  if (zeroHead(5) && groups[5] === "ffff") {
    const hi = parseInt(groups[6]!, 16);
    const lo = parseInt(groups[7]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (groups[0] === "0064" && groups[1] === "ff9b" && (groups.slice(2, 6).every((g) => g === "0000") || groups[2] === "0001")) return null;
  if (zeroHead(6) && !(groups[6] === "0000" && (groups[7] === "0000" || groups[7] === "0001"))) return null; // ::a.b.c.d (IPv4-compatible); :: and ::1 stay
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The caller's address as far as this deployment can TRUST it, for use as a rate-limit key only (never authorization).
 *
 * A client can put anything in `X-Forwarded-For`, so that header is never read on its own. What is trusted:
 *   1. On Vercel (`VERCEL=1`, set by the platform): `x-vercel-forwarded-for`, then `x-real-ip`. The platform's edge sets
 *      these to the connecting client and overwrites any client-supplied value.
 *   2. Elsewhere, only if the operator declares how many reverse proxies they run in front of the app with
 *      `AEGIS_TRUSTED_PROXY_HOPS=N` (1-5): the N-th entry counted from the RIGHT of `X-Forwarded-For`. Entries to its left
 *      are client-controlled and ignored; a chain shorter than N means the request did not pass through the proxies, so
 *      nothing is trusted.
 *   3. Otherwise no forwarding header is trusted and the result is `UNKNOWN_CLIENT_IP` (one shared bucket).
 * A value that is not a valid IP also yields `UNKNOWN_CLIENT_IP`, so a garbage header cannot create a private bucket.
 */
export function clientIpFromHeaders(headerList: HeaderReader, env: Env = process.env): string {
  if (env.VERCEL === "1") {
    const fromVercel = normalizeClientIp(headerList.get("x-vercel-forwarded-for")?.split(",")[0]) ?? normalizeClientIp(headerList.get("x-real-ip"));
    return fromVercel ?? UNKNOWN_CLIENT_IP;
  }

  const rawHops = env.AEGIS_TRUSTED_PROXY_HOPS?.trim();
  const hops = rawHops && /^\d+$/.test(rawHops) ? Number(rawHops) : 0;
  if (hops >= 1 && hops <= MAX_TRUSTED_HOPS) {
    const chain = (headerList.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    if (chain.length >= hops) return normalizeClientIp(chain[chain.length - hops]) ?? UNKNOWN_CLIENT_IP;
  }
  return UNKNOWN_CLIENT_IP;
}
