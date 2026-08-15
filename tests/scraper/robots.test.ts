import { describe, expect, it } from "vitest";
import {
  crawlIntervalMs,
  DEFAULT_MIN_INTERVAL_MS,
  MAX_CRAWL_DELAY_MS,
  parseRobots,
} from "@/lib/scraper/robots";

const ROBOTS_URL = "https://example.com/robots.txt";

describe("parseRobots", () => {
  it("honours a disallow that applies to everyone", () => {
    const rules = parseRobots(
      ROBOTS_URL,
      ["User-agent: *", "Disallow: /wp-admin/", "Disallow: /cart"].join("\n"),
    );

    expect(rules.isAllowed("https://example.com/wp-admin/edit.php")).toBe(false);
    expect(rules.isAllowed("https://example.com/cart")).toBe(false);
    expect(rules.isAllowed("https://example.com/about")).toBe(true);
  });

  it("applies a rule targeting our bot by name", () => {
    const rules = parseRobots(
      ROBOTS_URL,
      [
        "User-agent: *",
        "Disallow:",
        "",
        "User-agent: MoKnowledgeBot",
        "Disallow: /private",
      ].join("\n"),
    );

    expect(rules.isAllowed("https://example.com/private/x")).toBe(false);
    expect(rules.isAllowed("https://example.com/public")).toBe(true);
  });

  it("reads crawl-delay and declared sitemaps", () => {
    const rules = parseRobots(
      ROBOTS_URL,
      [
        "User-agent: *",
        "Crawl-delay: 3",
        "Sitemap: https://example.com/sitemap_index.xml",
      ].join("\n"),
    );

    expect(rules.crawlDelaySeconds).toBe(3);
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap_index.xml"]);
  });

  it("treats a blanket disallow as a blanket disallow", () => {
    const rules = parseRobots(
      ROBOTS_URL,
      ["User-agent: *", "Disallow: /"].join("\n"),
    );
    expect(rules.isAllowed("https://example.com/about")).toBe(false);
  });

  it("allows everything when robots.txt is empty", () => {
    // Most SMB sites don't publish one. Reading a 404 as a blanket disallow
    // would make the app useless on exactly its target customer.
    const rules = parseRobots(ROBOTS_URL, "");
    expect(rules.isAllowed("https://example.com/anything")).toBe(true);
  });
});

describe("crawlIntervalMs", () => {
  const base = { isAllowed: () => true, sitemaps: [], found: true };

  it("never goes below our own politeness floor", () => {
    expect(crawlIntervalMs({ ...base, crawlDelaySeconds: null })).toBe(
      DEFAULT_MIN_INTERVAL_MS,
    );
    expect(crawlIntervalMs({ ...base, crawlDelaySeconds: 0.2 })).toBe(
      DEFAULT_MIN_INTERVAL_MS,
    );
  });

  it("obeys a slower crawl-delay when the site asks for one", () => {
    expect(crawlIntervalMs({ ...base, crawlDelaySeconds: 3 })).toBe(3000);
  });

  it("caps an unreasonable crawl-delay rather than hanging the request", () => {
    expect(crawlIntervalMs({ ...base, crawlDelaySeconds: 3600 })).toBe(
      MAX_CRAWL_DELAY_MS,
    );
  });
});
