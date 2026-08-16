import {
  buildQuality,
  isFilled,
} from "./analyzers/completeness";
import { computeCadence, detectHeadlinePatterns, findContentGaps, buildTaxonomy } from "./analyzers/content";
import { assignColorRoles } from "./analyzers/palette";
import { analyzeText, extractThemes, type TextMetrics } from "./analyzers/text";
import { crawlSite, type CrawlOptions, type CrawlResult, type CrawledDocument } from "./crawler";
import type { Evidence, PageInput, SiteContext } from "./evidence";
import { extractAssets } from "./extractors/assets";
import { extractContact, visibleText } from "./extractors/contact";
import { extractContent } from "./extractors/content";
import { extractIdentity } from "./extractors/identity";
import { extractJsonLd } from "./extractors/jsonld";
import { extractLocations } from "./extractors/locations";
import { extractMetadata } from "./extractors/metadata";
import { extractOfferings } from "./extractors/offerings";
import { extractPeople } from "./extractors/people";
import { extractProof } from "./extractors/proof";
import { extractVendors } from "./extractors/vendors";
import { reconcile } from "./reconcile";
import {
  createEmptyKnowledgeBase,
  derived,
  newId,
  SCRAPER_VERSION,
  type BrandColor,
  type Conflict,
  type ContentItem,
  type KnowledgeBase,
  type Offering,
  type ScrapeMetadata,
  type Sourced,
} from "@/lib/schema";
import { getPath, setPath } from "@/lib/utils/path";
import { registrableDomain } from "@/lib/utils/url";
import * as cheerio from "cheerio";
import { buildEnrichmentInput, enrich, type EnrichmentReport } from "@/lib/ai/enrich";

/**
 * Crawl → extract → reconcile → analyze → enrich.
 *
 * Split into a synchronous deterministic core and an async enrichment step,
 * which is what makes the extraction half testable. `scripts/validate.ts` and
 * every fixture test call `buildKnowledgeBase` with saved HTML and never touch
 * the network or a model; `scrapeSite` is the wrapper the app route uses.
 */

export type PipelineOptions = CrawlOptions & {
  id?: string;
  /** Fixed clock, so fixture tests and golden scoring are reproducible. */
  now?: Date;
  /** Off for extraction-only runs (validation, unit tests). */
  enrich?: boolean;
};

export type ExtractionResult = {
  knowledgeBase: KnowledgeBase;
  conflicts: Conflict[];
  metrics: TextMetrics;
  /** Cleaned page text, reused by enrichment so the corpus is built once. */
  pageTexts: Array<{ url: string; role: CrawledDocument["role"]; text: string }>;
};

export type PipelineResult = ExtractionResult & {
  crawl: CrawlResult;
  enrichment: EnrichmentReport | null;
};

const EXTRACTORS = [
  extractJsonLd,
  extractMetadata,
  extractContact,
  extractIdentity,
  extractLocations,
  extractAssets,
  extractVendors,
  extractProof,
  extractPeople,
  extractOfferings,
  extractContent,
] as const;

/* ------------------------------------------------------------------ core */

/**
 * The deterministic half: pages in, knowledge base out, no network, no model.
 *
 * Every extractor runs over every page, and disagreements are settled by the
 * reconciler rather than by extractor order — that is the whole reason
 * extractors return `Evidence[]` instead of writing fields.
 */
export function buildKnowledgeBase(
  crawl: CrawlResult,
  options: PipelineOptions = {},
): ExtractionResult {
  const now = options.now ?? new Date();
  const site: SiteContext = {
    originUrl: crawl.originUrl,
    // `registrableDomain` takes a hostname, not a URL — passing the URL made
    // every extractor treat the site's own assets as third-party.
    domain: hostnameOf(crawl.originUrl),
  };

  const claims: Evidence[] = [];
  const pageTexts: ExtractionResult["pageTexts"] = [];

  for (const document of crawl.pages) {
    const page: PageInput = {
      url: document.url,
      role: document.role,
      html: document.html,
    };

    for (const extractor of EXTRACTORS) {
      try {
        claims.push(...extractor(page, site));
      } catch {
        // An extractor that throws on one page's malformed markup must not cost
        // us the other eight extractors' findings on that page.
      }
    }

    try {
      pageTexts.push({
        url: document.url,
        role: document.role,
        text: visibleText(cheerio.load(document.html)),
      });
    } catch {
      pageTexts.push({ url: document.url, role: document.role, text: "" });
    }
  }

  const base = createEmptyKnowledgeBase({
    id: options.id,
    sourceUrl: crawl.originUrl,
    now: now.toISOString(),
  });

  const { knowledgeBase, conflicts } = reconcile(claims, base);
  const metrics = analyzeText(pageTexts.map((page) => page.text).join("\n\n"));

  let kb = knowledgeBase;
  kb = deriveFromCorpus(kb, pageTexts, crawl, now);
  kb = { ...kb, scrape: scrapeMetadata(crawl) };
  kb = { ...kb, quality: buildQuality(kb, conflicts) };

  return { knowledgeBase: kb, conflicts, metrics, pageTexts };
}

/* ---------------------------------------------------------- derivations */

/**
 * Everything that needs the whole corpus rather than one page.
 *
 * These run after reconciliation because they operate on the merged result —
 * colour roles need the deduped palette, content gaps need the deduped offering
 * list, and both would be computed per-page and thrown away otherwise.
 */
function deriveFromCorpus(
  knowledgeBase: KnowledgeBase,
  pageTexts: ExtractionResult["pageTexts"],
  crawl: CrawlResult,
  now: Date,
): KnowledgeBase {
  let kb = knowledgeBase;
  const urls = crawl.pages.map((page) => page.url);

  /* ----------------------------------------------------------- website */

  // The URL the user submitted is a fact about the company, not an inference.
  if (!isFilled(kb.foundation.website)) {
    kb = setPath(kb, "foundation.website", derived(crawl.originUrl, [crawl.originUrl], 0.95));
  }

  /* ------------------------------------------------------------ colors */

  const colors = kb.branding.colors.value;
  if (colors && colors.length > 0) {
    const roled = assignColorRoles(colors as BrandColor[]).slice(0, 12);
    kb = setPath(kb, "branding.colors", {
      ...kb.branding.colors,
      value: roled,
    } satisfies Sourced<BrandColor[]>);
  }

  /* ------------------------------------------------------------ themes */

  const themes = extractThemes(pageTexts.map((page) => ({ url: page.url, text: page.text })));
  if (themes.length > 0) {
    kb = setPath(
      kb,
      "contentIntelligence.themes",
      derived(
        themes.map((theme) => ({
          id: newId(),
          method: "derived" as const,
          confidence: 0.7,
          sourceUrls: theme.exampleUrls,
          ...theme,
        })),
        urls,
        0.7,
      ),
    );
  }

  /* ------------------------------------------------------------ content */

  const posts = (kb.contentIntelligence.posts.value ?? []) as ContentItem[];

  const cadence = computeCadence(posts, now);
  if (cadence) {
    kb = setPath(kb, "contentIntelligence.cadence", derived(cadence, urls, 0.75));
  }

  const patterns = detectHeadlinePatterns(posts);
  if (patterns.length > 0) {
    kb = setPath(kb, "contentIntelligence.headlinePatterns", derived(patterns, urls, 0.7));
  }

  const taxonomy = buildTaxonomy(posts);
  if (taxonomy) {
    kb = setPath(kb, "contentIntelligence.taxonomy", derived(taxonomy, urls, 0.8));
  }

  const gaps = findContentGaps({
    offerings: (kb.offerings.value ?? []) as Offering[],
    posts,
    pageUrls: urls,
  });
  if (gaps.length > 0) {
    kb = setPath(kb, "contentIntelligence.contentGaps", derived(gaps, urls, 0.6));
  }

  /* ---------------------------------------------------------- channels */

  const channels = deriveChannels(kb);
  if (channels.length > 0) {
    kb = setPath(kb, "market.channels", derived(channels, urls, 0.55));
  }

  return kb;
}

/**
 * Marketing channels, inferred only from things the site actually shows.
 *
 * A linked Facebook page is evidence the company markets on Facebook; a blog
 * with posts is evidence of content marketing. Nothing here is guessed from the
 * industry, which is why "referral" and "trade shows" — both common in the
 * reference profiles — never appear: no page can prove them, and they are
 * exactly what the follow-up question in `market.channels` asks the owner.
 */
function deriveChannels(kb: KnowledgeBase): string[] {
  const channels = new Set<string>();

  const PLATFORM_LABELS: Record<string, string> = {
    linkedin: "LinkedIn",
    facebook: "Facebook",
    instagram: "Instagram",
    x: "X (Twitter)",
    youtube: "YouTube",
    tiktok: "TikTok",
    pinterest: "Pinterest",
    yelp: "Yelp",
    "google-business": "Google Business Profile",
  };

  for (const profile of kb.onlinePresence.profiles.value ?? []) {
    const label = PLATFORM_LABELS[profile.platform];
    if (label) channels.add(label);
  }

  if ((kb.contentIntelligence.posts.value ?? []).length > 0) {
    channels.add("Blog / organic search");
  }

  // The site itself is a channel, and on most SMB sites it is *the* channel —
  // the reference profiles say so in seven of eight ("Online via website",
  // "Direct Sales (via website forms and phone calls)"). A quote form is the
  // evidence for the first; a `tel:` link is the evidence for the second.
  const funnelText = (kb.market.funnels.value ?? []).join(" ");
  if (/form|quote|booking|checkout|contact/i.test(funnelText)) {
    channels.add("Website");
  }
  if (kb.foundation.phone.value || /phone|call/i.test(funnelText)) {
    channels.add("Phone");
  }

  if (/newsletter|email/i.test(funnelText)) {
    channels.add("Email");
  }

  return [...channels];
}

/* ------------------------------------------------------------- metadata */

function scrapeMetadata(crawl: CrawlResult): ScrapeMetadata {
  return {
    startedAt: crawl.startedAt,
    finishedAt: crawl.finishedAt,
    durationMs: crawl.durationMs,
    pagesDiscovered: crawl.pagesDiscovered,
    pages: crawl.pages.map((page) => ({
      url: page.url,
      role: page.role,
      status: page.status,
      bytes: page.bytes,
      fetchedAt: page.fetchedAt,
    })),
    robotsRespected: crawl.robotsRespected,
    warnings: crawl.warnings,
    scraperVersion: SCRAPER_VERSION,
  };
}

/* ------------------------------------------------------------- the whole */

export async function scrapeSite(
  url: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const crawl = await crawlSite(url, options);
  const extraction = buildKnowledgeBase(crawl, options);

  if (options.enrich === false) {
    return { ...extraction, crawl, enrichment: null };
  }

  const enriched = await enrichKnowledgeBase(extraction);
  return { ...extraction, ...enriched, crawl };
}

/**
 * Runs the four prompts and rescores quality afterwards.
 *
 * Rescoring matters: enrichment fills `overview`, `pitch`, and `writingStyle`,
 * and a completeness score computed before that runs would understate the
 * result and generate follow-up questions for fields that are no longer empty.
 */
export async function enrichKnowledgeBase(
  extraction: ExtractionResult,
): Promise<{ knowledgeBase: KnowledgeBase; enrichment: EnrichmentReport }> {
  const input = buildEnrichmentInput(
    extraction.knowledgeBase,
    extraction.pageTexts,
    extraction.metrics,
  );

  const { knowledgeBase, report } = await enrich(extraction.knowledgeBase, input);

  return {
    knowledgeBase: {
      ...knowledgeBase,
      quality: buildQuality(knowledgeBase, extraction.conflicts),
    },
    enrichment: report,
  };
}

function hostnameOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return url;
  }
}

/** Reads a field off a knowledge base by dot path, for scripts and tests. */
export function fieldValue(kb: KnowledgeBase, path: string): unknown {
  const field = getPath(kb, path) as Sourced<unknown> | undefined;
  return field?.value ?? null;
}
