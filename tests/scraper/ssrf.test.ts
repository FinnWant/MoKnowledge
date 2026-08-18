import { afterEach, describe, expect, it } from "vitest";
import {
  blockedAddress,
  blockedHost,
  blockedLiteralHost,
  clearHostCache,
} from "@/lib/scraper/ssrf";

/**
 * The SSRF guard (P8).
 *
 * This app takes a URL from a form and fetches it on the server, so the
 * adversarial input is not a malformed URL — it is a perfectly well-formed one
 * pointing at something that isn't a website. `169.254.169.254` has dots in it
 * and passes every syntactic check we had before this.
 *
 * The false-negative cases matter as much as the positives: a guard that blocks
 * real customer sites is one somebody will switch off.
 */

afterEach(() => {
  clearHostCache();
});

describe("blockedLiteralHost", () => {
  it("blocks the addresses an attacker actually reaches for", () => {
    const cases: Array<[string, RegExp]> = [
      // The one that matters most: EC2/GCP instance credentials live here.
      ["169.254.169.254", /link-local/],
      ["127.0.0.1", /loopback/],
      ["0.0.0.0", /unspecified/],
      ["10.0.0.1", /private/],
      ["172.16.0.1", /private/],
      ["172.31.255.255", /private/],
      ["192.168.1.1", /private/],
      ["100.64.0.1", /carrier-grade/],
      ["198.18.0.1", /benchmarking/],
      ["224.0.0.1", /multicast/],
      ["255.255.255.255", /reserved/],
    ];
    for (const [host, reason] of cases) {
      expect(blockedLiteralHost(host), host).toMatch(reason);
    }
  });

  it("blocks names that only ever mean this machine or this network", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "printer.local",
      "db.internal",
      "router.home.arpa",
      // A trailing dot is a valid absolute name and must not slip past.
      "localhost.",
    ]) {
      expect(blockedLiteralHost(host), host).toMatch(/local machine/);
    }
  });

  it("blocks IPv6 loopback, private, and link-local", () => {
    expect(blockedLiteralHost("::1")).toMatch(/loopback/);
    expect(blockedLiteralHost("[::1]")).toMatch(/loopback/);
    expect(blockedLiteralHost("::")).toMatch(/unspecified/);
    expect(blockedLiteralHost("fd00::1")).toMatch(/private/);
    expect(blockedLiteralHost("fe80::1")).toMatch(/link-local/);
    expect(blockedLiteralHost("ff02::1")).toMatch(/multicast/);
    expect(blockedLiteralHost("2001:db8::1")).toMatch(/documentation/);
  });

  it("reads the v4 address hidden inside a v6 one", () => {
    // Both of these are loopback wearing a different notation, and the second
    // writes the octets in hex — so this cannot be done by string matching.
    expect(blockedLiteralHost("::ffff:127.0.0.1")).toMatch(/loopback/);
    expect(blockedLiteralHost("64:ff9b::7f00:1")).toMatch(/loopback/);
    expect(blockedLiteralHost("::ffff:169.254.169.254")).toMatch(/link-local/);
  });

  it("lets real websites through, including the neighbours of blocked ranges", () => {
    for (const host of [
      "example.com",
      "beecavedrilling.com",
      "blog.account-it.net",
      // One octet outside 172.16.0.0/12, 10.0.0.0/8, 100.64.0.0/10 and
      // 127.0.0.0/8 respectively. An off-by-one in the mask shows up here.
      ["172.32.0.1", "11.0.0.1", "99.64.0.1", "128.0.0.1"],
    ].flat()) {
      expect(blockedLiteralHost(host), host).toBeNull();
    }
  });

  it("does not treat a name containing a blocked word as blocked", () => {
    // `.local` is a suffix rule, not a substring one.
    expect(blockedLiteralHost("locally-grown.com")).toBeNull();
    expect(blockedLiteralHost("localhosting.co.uk")).toBeNull();
    expect(blockedLiteralHost("internal-affairs.org")).toBeNull();
  });
});

describe("blockedAddress", () => {
  it("says nothing about a hostname, which is not an address", () => {
    expect(blockedAddress("example.com")).toBeNull();
    expect(blockedAddress("not an ip")).toBeNull();
  });
});

/**
 * These three resolve for real, which is the point — the mechanism under test
 * *is* DNS resolution, and stubbing it would leave the interesting half
 * unexercised. The cost is that they are the only tests here that depend on the
 * network, so they get a generous timeout and a retry: on a loaded machine the
 * default 5s budget is enough to fail one of them while nothing is actually
 * wrong. A resolver that is genuinely unreachable still passes, because
 * `blockedHost` allows a name it cannot resolve.
 */
describe("blockedHost", () => {
  it("blocks a public name that resolves to a private address", { timeout: 30_000, retry: 2 }, async () => {
    // nip.io answers every `<ip>.nip.io` with that ip. It is the standard way
    // past a guard that only inspects the hostname text, and the reason this
    // function resolves rather than pattern-matches.
    expect(await blockedHost("127.0.0.1.nip.io")).toMatch(/loopback/);
  });

  it("allows a name that resolves publicly", { timeout: 30_000, retry: 2 }, async () => {
    expect(await blockedHost("example.com")).toBeNull();
  });

  it("allows a name that cannot be resolved at all", { timeout: 30_000, retry: 2 }, async () => {
    // Failing closed here would block every scrape on a machine with no DNS,
    // including the offline test run — and `fetch` is about to fail anyway.
    expect(await blockedHost("no-such-host-4bf19a2c.invalid")).toBeNull();
  });
});
