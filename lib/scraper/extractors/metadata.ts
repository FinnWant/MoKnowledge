import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * OpenGraph and `<meta>` tags — the universal fallback.
 *
 * All seven captured golden sites emit OpenGraph on every page, including the
 * one with no JSON-LD at all. It carries the company name, a description, and a
 * usable image on sites that publish nothing else machine-readable.
 */

/** Suffixes a site appends to its own name in `<title>` and `og:site_name`. */
const TITLE_SUFFIX =
  /\s*[|\-–—·»]\s*(home|homepage|official site|official website|welcome)\s*$/i;

export function extractMetadata(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];

  const meta = (selector: string): string | null =>
    $(selector).attr("content")?.trim() || null;

  const og = (property: string) =>
    meta(`meta[property="og:${property}"]`) ?? meta(`meta[name="og:${property}"]`);

  /* ------------------------------------------------------ company name */

  const siteName = og("site_name");
  if (siteName) {
    out.push(evidence("companyName", cleanName(siteName), "opengraph", page));
  } else if (page.role === "home") {
    // The homepage `<title>` is the last resort for a name, and it is noisy
    // enough ("Water Well Drilling Austin TX | Bee Cave Drilling") that it only
    // earns a claim when nothing better exists.
    const title = $("title").first().text().trim();
    const candidate = nameFromTitle(title);
    if (candidate) {
      out.push(
        evidence("companyName", candidate, "heuristic", page, {
          confidence: 0.5,
          note: "Taken from the page title",
        }),
      );
    }
  }

  /* -------------------------------------------------------- description */

  const description =
    og("description") ??
    meta('meta[name="description"]') ??
    meta('meta[name="twitter:description"]');
  if (description && description.length > 40) {
    // SEO copy, not a real overview — it seeds enrichment rather than answering.
    out.push(
      evidence("foundation.overview", description, "meta", page, {
        confidence: page.role === "home" ? 0.5 : 0.35,
      }),
    );
  }

  /* -------------------------------------------------------------- image */

  if (page.role === "home") {
    const image = og("image") ?? meta('meta[name="twitter:image"]');
    const resolved = image ? normalizeUrl(image, page.url) : null;
    if (resolved) {
      // An og:image is the social preview, which is only sometimes the logo.
      // Low confidence, and the DOM logo extractor usually beats it.
      out.push(
        evidence(
          "branding.logos",
          {
            id: `og-image-${page.role}`,
            method: "scraped" as const,
            confidence: 0.4,
            sourceUrls: [],
            url: resolved,
            alt: og("image:alt") ?? null,
            kind: "logo" as const,
            width: null,
            height: null,
          },
          "opengraph",
          page,
          { confidence: 0.4, note: "Social sharing image; may not be the logo" },
        ),
      );
    }
  }

  /* ---------------------------------------------------------- site url */

  const canonicalUrl = og("url") ?? $('link[rel="canonical"]').attr("href");
  if (canonicalUrl && page.role === "home") {
    const resolved = normalizeUrl(canonicalUrl, page.url);
    if (resolved) out.push(evidence("foundation.website", resolved, "opengraph", page));
  }

  /* ------------------------------------------------------- google fonts */

  for (const href of googleFontHrefs($)) {
    for (const family of parseGoogleFontFamilies(href)) {
      out.push(evidence("branding.fonts", family, "meta", page, { confidence: 0.9 }));
    }
  }

  void site;
  return out;
}

function cleanName(value: string): string {
  return value.replace(TITLE_SUFFIX, "").trim();
}

/**
 * SMB titles are keyword-stuffed for SEO: "Water Well Drilling Austin TX |
 * Bee Cave Drilling". The company name is normally the shortest segment and
 * usually the last, so prefer that over the longest keyword phrase.
 */
export function nameFromTitle(title: string): string | null {
  if (!title) return null;

  const segments = title
    .split(/\s*[|\-–—·»]\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 1 && !TITLE_SUFFIX.test(segment));
  if (segments.length === 0) return null;

  const shortest = [...segments].sort((a, b) => a.length - b.length)[0];
  return shortest.length <= 60 ? shortest : null;
}

function googleFontHrefs($: cheerio.CheerioAPI): string[] {
  const hrefs: string[] = [];
  $('link[href*="fonts.googleapis.com"]').each((_, element) => {
    const href = $(element).attr("href");
    if (href) hrefs.push(href);
  });
  return hrefs;
}

/** `…/css2?family=Poppins:wght@400;700&family=DM+Serif+Text` → two families. */
export function parseGoogleFontFamilies(href: string): string[] {
  const families: string[] = [];
  const pattern = /family=([^&:]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(href)) !== null) {
    const family = decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
    if (family) families.push(family);
  }
  return families;
}
