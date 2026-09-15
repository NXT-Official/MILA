import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

// IPv4 ranges that must never be reachable from a server-side fetch of an
// arbitrary external URL (retailer links, garment reference images): RFC
// 1918 private ranges, loopback, link-local, and other non-routable blocks.
const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // unique local
    lower.startsWith("::ffff:127.") ||
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:192.168.")
  );
}

export type DnsLookup = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

async function assertPublicHostname(hostname: string, lookup: DnsLookup): Promise<void> {
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error("Could not resolve host.");
  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (isPrivate) throw new Error("Refusing to fetch a private or internal address.");
  }
}

/**
 * Fetches an arbitrary external URL (retailer affiliate links, garment
 * reference images) with SSRF guards: only http(s), DNS-resolves and rejects
 * private/loopback/link-local destinations before connecting, and
 * re-validates every redirect hop the same way instead of trusting a single
 * upfront check. Bounded redirects and timeout.
 */
export async function safeExternalFetch(
  url: string,
  init?: RequestInit & { maxRedirects?: number },
  deps: { dnsLookup?: DnsLookup; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const maxRedirects = init?.maxRedirects ?? MAX_REDIRECTS;
  const lookup = deps.dnsLookup ?? dns.lookup;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http(s) URLs are allowed.");
    }
    const ipFamily = net.isIP(parsed.hostname);
    if (ipFamily) {
      const isPrivate =
        ipFamily === 6 ? isPrivateIpv6(parsed.hostname) : isPrivateIpv4(parsed.hostname);
      if (isPrivate) throw new Error("Refusing to fetch a private address.");
    } else {
      await assertPublicHostname(parsed.hostname, lookup);
    }

    const res = await fetchImpl(currentUrl, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      currentUrl = new URL(res.headers.get("location")!, currentUrl).toString();
      continue;
    }

    return res;
  }

  throw new Error("Too many redirects.");
}
