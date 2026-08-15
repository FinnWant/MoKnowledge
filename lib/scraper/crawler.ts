import type { PageRole, ScrapeWarning } from "@/lib/schema";
import { classifyUrl, HIGH_VALUE_ROLES } from "./classify";
import { detectJsRendered } from "./detect";
import { toWarning, type ScrapeError } from "./errors";
import { fetchPage, HostRateLimiter, type FetchedPage } from "./fetcher";
import { extractLinks } from "./links";
import { crawlIntervalMs, fetchRobots, type RobotsRules } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * The crawl.
 *
 * Budgeted, rate-limited, robots-respecting, and priority-ordered, so that a
 * truncated crawl still returns the pages that carry knowledge. Never throws:
 * every failure becomes a warning attached to a partial result, because a
 * half-scraped site is a useful output and a dead end is not.
 */

export const DEFAULT_MAX_PAGES = 20;
/**
 * Concurrent requests. They share one rate limiter, so throughput stays at the
 * ~1 req/sec the etiquette rules require (docs/VALIDATION.md §5) — concurrency
 * buys us tolerance of a slow page, not extra load on the host.
 */
export const DEFAULT_CONCURRENCY = 4;

export type CrawledDocument = {
  url: string;
  role: PageRole;
  html: string;
  status: number;
  bytes: number;
  fetchedAt: string;
};

export type CrawlProgressEvent =
  | { type: "start"; url: string }
  | {
      type: "robots";
      found: boolean;
      crawlDelayMs: number;
      sitemapCount: number;
    }
  | { type: "discovered"; count: number; source: "sitemap" | "links" }
  | {
      type: "page";
      url: string;
      role: PageRole;
      fetched: number;
      budget: number;
    }
  | { type: "warning"; warning: ScrapeWarning }
  | { type: "done"; pagesFetched: number; durationMs: number };

export type CrawlOptions = {
  maxPages?: number;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: CrawlProgressEvent) => void;
  /**
   * Lower bound on the gap between requests. Tests pass 0 so the suite doesn't
   * sleep; nothing in the app sets it. A site's own `Crawl-delay` still wins,
   * so this can only make us more polite than the default, never less than what
   * the site asked for.
   */
  politenessFloorMs?: number;
};

export type CrawlResult = {
  originUrl: string;
  pages: CrawledDocument[];
  warnings: ScrapeWarning[];
  pagesDiscovered: number;
  robotsRespected: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

type Candidate = {
  url: string;
  role: PageRole;
  priority: number;
};

export async function crawlSite(
  inputUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const originUrl = normalizeUrl(inputUrl);
  if (!originUrl) return invalidUrlResult(inputUrl);
  return crawlNormalizedSite(originUrl, options);
}

/** An unusable URL is still a result with a warning, never a thrown error. */
function invalidUrlResult(inputUrl: string): CrawlResult {
  const now = new Date().toISOString();
  return {
    originUrl: inputUrl,
    pages: [],
    warnings: [
      {
        code: "fetch-failed",
        message: `"${inputUrl}" isn't a web address we can read.`,
        url: null,
      },
    ],
    pagesDiscovered: 0,
    robotsRespected: true,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  };
}

async function crawlNormalizedSite(
  originUrl: string,
  options: CrawlOptions,
): Promise<CrawlResult> {
  const {
    maxPages = DEFAULT_MAX_PAGES,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs,
    signal,
    onProgress,
    politenessFloorMs,
  } = options;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const emit = (event: CrawlProgressEvent) => onProgress?.(event);

  const warnings: ScrapeWarning[] = [];
  const pages: CrawledDocument[] = [];
  /** URLs queued or discarded, keyed before the request goes out. */
  const seen = new Set<string>();
  /** URLs we actually landed on, keyed after redirects resolve. */
  const fetchedUrls = new Set<string>();
  const frontier: Candidate[] = [];
  /** Budget slots taken: pages fetched plus requests currently in flight. */
  let claimed = 0;
  /** Requests made, successful or not. Bounds a site with heavy link rot. */
  let attempts = 0;
  const maxAttempts = maxPages * 2;

  emit({ type: "start", url: originUrl });

  const robots = await fetchRobots(originUrl, { timeoutMs });
  const intervalMs = crawlIntervalMs(robots, politenessFloorMs);
  const limiter = new HostRateLimiter(intervalMs);
  emit({
    type: "robots",
    found: robots.found,
    crawlDelayMs: intervalMs,
    sitemapCount: robots.sitemaps.length,
  });

  if (!robots.isAllowed(originUrl)) {
    warnings.push({
      code: "robots-disallow",
      message:
        "This site asks automated tools not to read it. We stopped without reading anything.",
      url: originUrl,
    });
    return finish();
  }

  // Marked seen before anything is discovered: the sitemap almost always lists
  // the homepage, and enqueuing it there would have a worker fetch it a second
  // time after the explicit crawl below.
  seen.add(originUrl);

  const sitemapEntries = await discoverFromSitemaps(originUrl, robots.sitemaps, {
    timeoutMs,
  });
  if (sitemapEntries.length > 0) {
    emit({ type: "discovered", count: sitemapEntries.length, source: "sitemap" });
    for (const entry of sitemapEntries) enqueue(entry.url);
  }

  // The homepage goes first and alone: its nav is the best discovery source we
  // have, and fanning out before reading it wastes budget on sitemap ordering.
  claimed += 1;
  if (!(await crawlOne(originUrl, "home"))) claimed -= 1;

  const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return finish();

  /* ------------------------------------------------------------------ */

  function enqueue(url: string, anchorText?: string, bonus = 0): void {
    const normalized = normalizeUrl(url);
    if (!normalized || seen.has(normalized)) return;
    if (!robots.isAllowed(normalized)) {
      // Recorded once, not per link, so a disallowed section doesn't flood the list.
      if (!warnings.some((warning) => warning.code === "robots-disallow")) {
        warnings.push({
          code: "robots-disallow",
          message:
            "This site asks automated tools not to read some of its pages. We skipped those.",
          url: normalized,
        });
      }
      seen.add(normalized);
      return;
    }

    seen.add(normalized);
    const { role, priority } = classifyUrl(normalized, anchorText);
    frontier.push({ url: normalized, role, priority: priority + bonus });
  }

  function takeNext(): Candidate | undefined {
    if (frontier.length === 0) return undefined;

    let bestIndex = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (frontier[i].priority > frontier[bestIndex].priority) bestIndex = i;
    }
    return frontier.splice(bestIndex, 1)[0];
  }

  async function worker(): Promise<void> {
    while (!signal?.aborted) {
      // The slot is claimed *before* the await. Checking `pages.length` alone
      // lets all four workers pass the test before any of them pushes a result,
      // which is how a 20-page budget fetched 23 pages.
      if (claimed >= maxPages || attempts >= maxAttempts) return;
      const candidate = takeNext();
      if (!candidate) return;

      claimed += 1;
      const fetched = await crawlOne(candidate.url, candidate.role);
      // A failed fetch shouldn't cost a page of budget, but it did cost a
      // request — `attempts` is what stops a link-rot-heavy site looping.
      if (!fetched) claimed -= 1;
    }
  }

  /** Resolves true when a page was actually added. */
  async function crawlOne(url: string, knownRole?: PageRole): Promise<boolean> {
    if (signal?.aborted) return false;
    attempts += 1;

    await limiter.wait();
    let result = await fetchPage(url, { timeoutMs, originUrl, signal });

    if (!result.ok && result.error.retryable) {
      await limiter.wait();
      result = await fetchPage(url, { timeoutMs, originUrl, signal });
    }

    if (!result.ok) {
      recordFailure(result.error);
      return false;
    }

    const page = result.value;

    // Dedupe on the URL we *landed* on, not the one we asked for. Redirects are
    // how a 20-page budget turns into 9 copies of the homepage: `/blog`,
    // `/listings`, and half a nav can all 301 to `/`, and each looks like a
    // distinct URL until the response comes back.
    const landedUrl = normalizeUrl(page.url) ?? page.url;
    if (fetchedUrls.has(landedUrl)) return false;
    fetchedUrls.add(landedUrl);
    seen.add(landedUrl);

    const role = knownRole ?? classifyUrl(landedUrl).role;
    pages.push(toDocument({ ...page, url: landedUrl }, role));
    emit({ type: "page", url: landedUrl, role, fetched: pages.length, budget: maxPages });

    if (pages.length === 1) checkHomepageReadability(page);
    harvestLinks(page);
    return true;
  }

  function recordFailure(error: ScrapeError): void {
    const warning = toWarning(error);
    warnings.push(warning);
    emit({ type: "warning", warning });
  }

  function toDocument(page: FetchedPage, role: PageRole): CrawledDocument {
    return {
      url: page.url,
      role,
      html: page.html,
      status: page.status,
      bytes: page.bytes,
      fetchedAt: page.fetchedAt,
    };
  }

  function checkHomepageReadability(page: FetchedPage): void {
    const verdict = detectJsRendered(page.html);
    if (!verdict.isJsRendered) return;

    const framework = verdict.framework ? ` (${verdict.framework})` : "";
    const warning: ScrapeWarning = {
      code: "js-rendered",
      message: `This site loads its content with JavaScript${framework}, which our scraper can't read yet. We got what we could from the page metadata.`,
      url: page.url,
    };
    warnings.push(warning);
    emit({ type: "warning", warning });
  }

  function harvestLinks(page: FetchedPage): void {
    const before = seen.size;
    for (const link of extractLinks(page.html, page.url, originUrl)) {
      enqueue(link.url, link.anchorText, link.placementBonus);
    }
    const added = seen.size - before;
    if (added > 0) {
      emit({ type: "discovered", count: added, source: "links" });
    }
  }

  function finish(): CrawlResult {
    const remaining = frontier.filter((candidate) =>
      HIGH_VALUE_ROLES.has(candidate.role),
    ).length;

    if (pages.length >= maxPages && frontier.length > 0) {
      warnings.push({
        code: "budget-exceeded",
        message: `We read ${maxPages} pages and stopped. ${frontier.length} more were found${
          remaining > 0 ? `, including ${remaining} we'd have liked to read` : ""
        }.`,
        url: null,
      });
    }

    if (pages.length === 0 && warnings.length === 0) {
      warnings.push({
        code: "empty-body",
        message: "We couldn't read any pages on this site.",
        url: originUrl,
      });
    }

    const durationMs = Date.now() - startMs;
    emit({ type: "done", pagesFetched: pages.length, durationMs });

    return {
      originUrl,
      pages,
      warnings,
      pagesDiscovered: seen.size,
      robotsRespected: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
    };
  }
}

/** Declared robots rules, exposed for tests and the snapshot script. */
export type { RobotsRules };
