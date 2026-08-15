import robotsParser from "robots-parser";
import { USER_AGENT } from "./fetcher";

/**
 * robots.txt handling.
 *
 * Honoured including `Crawl-delay`, per docs/VALIDATION.md §5. A missing or
 * unreadable robots.txt means "allowed" — that is what the standard says, and
 * treating a 404 as a blanket disallow would make the app useless on most SMB
 * sites, which don't publish one.
 */

/** Bot name we match rules against; the full UA string is sent on the wire. */
export const BOT_NAME = "MoKnowledgeBot";

export type RobotsRules = {
  isAllowed(url: string): boolean;
  /** Seconds, from `Crawl-delay`, or `null` when unspecified. */
  crawlDelaySeconds: number | null;
  /** Sitemap URLs declared in robots.txt. Often the fastest route to page discovery. */
  sitemaps: string[];
  /** False when robots.txt was missing or unreadable, so we defaulted to permissive. */
  found: boolean;
};

const ALLOW_ALL: RobotsRules = {
  isAllowed: () => true,
  crawlDelaySeconds: null,
  sitemaps: [],
  found: false,
};

export function parseRobots(robotsUrl: string, body: string): RobotsRules {
  const parsed = robotsParser(robotsUrl, body);

  return {
    // `isAllowed` returns undefined for a URL on a different host; that is not a
    // disallow, and the crawler has already restricted itself to this site.
    isAllowed: (url) => parsed.isAllowed(url, BOT_NAME) !== false,
    crawlDelaySeconds: parsed.getCrawlDelay(BOT_NAME) ?? null,
    sitemaps: parsed.getSitemaps(),
    found: true,
  };
}

/**
 * Fetches and parses `/robots.txt`. Deliberately does not go through
 * `fetchPage`: robots.txt is `text/plain`, so the HTML content-type check would
 * reject it, and it must be fetched before any rules are known.
 */
export async function fetchRobots(
  originUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<RobotsRules> {
  let robotsUrl: string;
  try {
    robotsUrl = new URL("/robots.txt", originUrl).toString();
  } catch {
    return ALLOW_ALL;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain,*/*" },
    });

    // 4xx means no rules. A 5xx arguably means "assume disallowed", but for a
    // user who explicitly asked us to read their own site, failing the whole
    // scrape on a flaky robots endpoint is the wrong trade.
    if (!response.ok) return ALLOW_ALL;

    return parseRobots(robotsUrl, await response.text());
  } catch {
    return ALLOW_ALL;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Interval between requests to one host: whichever is slower, our own floor or
 * the site's declared crawl-delay. Capped so a hostile `Crawl-delay: 3600`
 * doesn't hang the request — past the cap we stop rather than wait.
 */
export const DEFAULT_MIN_INTERVAL_MS = 1000;
export const MAX_CRAWL_DELAY_MS = 10_000;

export function crawlIntervalMs(
  rules: RobotsRules,
  floorMs: number = DEFAULT_MIN_INTERVAL_MS,
): number {
  const declared = (rules.crawlDelaySeconds ?? 0) * 1000;
  return Math.min(Math.max(floorMs, declared), MAX_CRAWL_DELAY_MS);
}
