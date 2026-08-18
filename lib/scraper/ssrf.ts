import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Refuses to fetch anything that isn't on the public internet (P8).
 *
 * The app takes a URL from a form and fetches it server-side, which is the exact
 * shape of a server-side request forgery. Without this, `169.254.169.254` — the
 * cloud metadata endpoint, and a perfectly valid hostname with dots in it —
 * passes `websiteInputSchema`, gets crawled, and has its credentials rendered
 * into a knowledge base as scraped content. `10.0.0.1` and `127.0.0.1:3000`
 * reach anything else on the host or its network the same way.
 *
 * Two checks, because either alone is insufficient:
 *
 * 1. **Literal** — the hostname is itself an address or a reserved name. Cheap,
 *    synchronous, and catches the direct attempt.
 * 2. **Resolved** — what the hostname actually points at. `127.0.0.1.nip.io` is
 *    a public name that resolves to loopback, and no amount of string
 *    inspection catches that.
 *
 * A lookup failure allows the host through. The alternative fails closed on
 * every machine with no DNS, including the offline test run, and it buys little:
 * a name we cannot resolve is a name `fetch` is about to fail on too.
 */

/** IPv4 ranges that are not the public internet. `[network, prefix bits]`. */
const BLOCKED_V4: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "an unspecified address"],
  ["10.0.0.0", 8, "a private network address"],
  ["100.64.0.0", 10, "a carrier-grade NAT address"],
  ["127.0.0.0", 8, "a loopback address"],
  ["169.254.0.0", 16, "a link-local address (this is where cloud metadata lives)"],
  ["172.16.0.0", 12, "a private network address"],
  ["192.0.0.0", 24, "a reserved address"],
  ["192.0.2.0", 24, "a documentation address"],
  ["192.168.0.0", 16, "a private network address"],
  ["198.18.0.0", 15, "a benchmarking address"],
  ["198.51.100.0", 24, "a documentation address"],
  ["203.0.113.0", 24, "a documentation address"],
  ["224.0.0.0", 4, "a multicast address"],
  ["240.0.0.0", 4, "a reserved address"],
];

/** Hostnames that never name a public site, matched as the name or a suffix. */
const BLOCKED_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function blockedV4(address: string): string | null {
  const value = v4ToInt(address);
  if (value === null) return null;

  for (const [network, bits, label] of BLOCKED_V4) {
    const base = v4ToInt(network);
    if (base === null) continue;
    // `>>> 0` because a /1..8 mask overflows a signed 32-bit shift.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((value & mask) >>> 0) === ((base & mask) >>> 0)) return label;
  }
  return null;
}

/** The eight 16-bit groups of an IPv6 address, or `null` if it won't parse. */
function expandV6(host: string): number[] | null {
  const [head, tail, ...rest] = host.split("::");
  if (rest.length > 0) return null;

  const parse = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const chunk of part.split(":")) {
      // A trailing dotted-quad ("::ffff:127.0.0.1") occupies two groups.
      if (chunk.includes(".")) {
        const value = v4ToInt(chunk);
        if (value === null) return null;
        groups.push(value >>> 16, value & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      groups.push(Number.parseInt(chunk, 16));
    }
    return groups;
  };

  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  if (left === null || right === null) return null;

  if (tail === undefined) return left.length === 8 ? left : null;

  const gap = 8 - left.length - right.length;
  if (gap < 0) return null;
  return [...left, ...Array<number>(gap).fill(0), ...right];
}

function blockedV6(address: string): string | null {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const groups = expandV6(host);
  if (groups === null) return null;

  // IPv4-mapped (::ffff:127.0.0.1) and NAT64 (64:ff9b::7f00:1) both carry a v4
  // address in the low 32 bits. Checking the v6 form alone waves them through,
  // and NAT64 writes those bits in hex rather than dotted quad — so read the
  // bits, not the text.
  const mapped = groups.slice(0, 6).every((g, i) => g === [0, 0, 0, 0, 0, 0xffff][i]);
  const nat64 =
    groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  if (mapped || nat64) {
    const low = (groups[6] << 16) | groups[7];
    const inner = blockedV4(
      [low >>> 24, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff].join("."),
    );
    if (inner) return inner;
  }

  if (groups.every((g) => g === 0)) return "an unspecified address";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "a loopback address";
  if ((groups[0] & 0xfe00) === 0xfc00) return "a private network address";
  if ((groups[0] & 0xffc0) === 0xfe80) return "a link-local address";
  if ((groups[0] & 0xff00) === 0xff00) return "a multicast address";
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return "a documentation address";
  return null;
}

/** The reason an address is not publicly routable, or `null` if it is. */
export function blockedAddress(address: string): string | null {
  const version = isIP(address.replace(/^\[|\]$/g, ""));
  if (version === 4) return blockedV4(address);
  if (version === 6) return blockedV6(address);
  return null;
}

/**
 * The reason a hostname is refused on its face, without resolving it.
 *
 * Returns `null` for an ordinary name — that only means it is not *obviously*
 * internal, so `blockedHost` still has to run before fetching.
 */
export function blockedLiteralHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return "an empty hostname";

  for (const suffix of BLOCKED_SUFFIXES) {
    if (host === suffix.replace(/^\./, "") || host.endsWith(suffix)) {
      return "a local machine name";
    }
  }

  return blockedAddress(host);
}

/**
 * One lookup per hostname per process. A twenty-page crawl of one site is one
 * DNS round trip, and the answer cannot change underneath a single scrape.
 */
const resolved = new Map<string, string | null>();

/** The reason a hostname must not be fetched, or `null` to allow it. */
export async function blockedHost(hostname: string): Promise<string | null> {
  const literal = blockedLiteralHost(hostname);
  if (literal) return literal;

  const host = hostname.toLowerCase().replace(/\.$/, "");
  const cached = resolved.get(host);
  if (cached !== undefined) return cached;

  let reason: string | null = null;
  try {
    for (const entry of await lookup(host, { all: true })) {
      const blocked = blockedAddress(entry.address);
      if (blocked) {
        reason = blocked;
        break;
      }
    }
  } catch {
    // See the header: a name we cannot resolve is one `fetch` will fail on too.
    reason = null;
  }

  resolved.set(host, reason);
  return reason;
}

/** Test seam — the cache is process-wide and would otherwise leak between cases. */
export function clearHostCache(): void {
  resolved.clear();
}

/** The message a user sees. Says what we refused and why, without jargon. */
export function blockedHostMessage(hostname: string, reason: string): string {
  return `${hostname} is ${reason}, not a public website. We only read sites on the public internet.`;
}
