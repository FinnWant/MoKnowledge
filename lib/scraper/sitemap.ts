import * as cheerio from "cheerio";
import { USER_AGENT } from "./fetcher";
import { isSameSite, looksLikeHtmlPage, normalizeUrl } from "@/lib/utils/url";

/**
 * Sitemap discovery.
 *
 * A sitemap is the highest-leverage thing to read first: it lists pages the
 * navigation may not link to, and it gives us the shape of the site before we
 * spend any of the crawl budget. Failure here is never fatal — most SMB sites
 * either have one at a predictable location or don't have one at all, and the
 * link-discovery path covers the rest.
 */

export const SITEMAP_CANDIDATES = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/wp-sitemap.xml",
  "/sitemap/sitemap.xml",
];

/** How many nested sitemaps to follow from an index. */
const MAX_SITEMAP_FILES = 5;
const MAX_URLS = 500;

export type SitemapEntry = {
  url: string;
  lastModified: string | null;
};

/**
 * Parses a sitemap or sitemap index. Returns `{ index: true }` with child sitemap
 * URLs when the document is an index rather than a list of pages.
 */
export function parseSitemapXml(
  xml: string,
  baseUrl: string,
): { index: boolean; entries: SitemapEntry[] } {
  const $ = cheerio.load(xml, { xmlMode: true });

  const isIndex = $("sitemapindex").length > 0;
  const selector = isIndex ? "sitemap" : "url";
  const entries: SitemapEntry[] = [];

  $(selector).each((_, element) => {
    const node = $(element);
    const loc = node.find("loc").first().text().trim();
    if (!loc) return;

    const normalized = normalizeUrl(loc, baseUrl);
    if (!normalized) return;

    entries.push({
      url: normalized,
      lastModified: node.find("lastmod").first().text().trim() || null,
    });
  });

  return { index: isIndex, entries };
}

async function fetchText(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Collects page URLs from a site's sitemaps, following one level of index.
 *
 * @param declaredSitemaps URLs from robots.txt, tried before the guessed paths.
 */
export async function discoverFromSitemaps(
  originUrl: string,
  declaredSitemaps: string[] = [],
  options: { timeoutMs?: number; fetchImpl?: typeof fetchText } = {},
): Promise<SitemapEntry[]> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const load = options.fetchImpl ?? fetchText;

  const candidates = [
    ...declaredSitemaps,
    ...SITEMAP_CANDIDATES.map((path) => {
      try {
        return new URL(path, originUrl).toString();
      } catch {
        return null;
      }
    }).filter((url): url is string => url !== null),
  ];

  const seenSitemaps = new Set<string>();
  const entries = new Map<string, SitemapEntry>();
  const queue = [...new Set(candidates)];
  let filesRead = 0;

  while (queue.length > 0 && filesRead < MAX_SITEMAP_FILES) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    const xml = await load(sitemapUrl, timeoutMs);
    if (!xml || !xml.includes("<")) continue;
    filesRead += 1;

    const { index, entries: found } = parseSitemapXml(xml, sitemapUrl);

    if (index) {
      // Prefer child sitemaps that sound like pages over ones full of images.
      const ranked = found
        .map((entry) => entry.url)
        .filter((url) => !/image|video|category|tag|author/i.test(url));
      queue.push(...ranked);
      continue;
    }

    for (const entry of found) {
      if (entries.size >= MAX_URLS) break;
      if (!isSameSite(entry.url, originUrl)) continue;
      if (!looksLikeHtmlPage(entry.url)) continue;
      entries.set(entry.url, entry);
    }

    // One good sitemap is enough; keep reading only if it was thin.
    if (entries.size > 20) break;
  }

  return [...entries.values()];
}
