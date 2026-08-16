import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * Products and services from services-page DOM structures.
 *
 * Emits *candidates*, not a catalogue. The same offering appears on the services
 * index, in the nav, on its own landing page, and in a footer list under four
 * slightly different names — consolidation is the reconciler's job, and on a
 * live-AI run it is prompts/02-offering-normalization.md's. Over-emitting here
 * is correct: a candidate that never gets merged is visible, one that was never
 * extracted is not.
 */

const CARD_SELECTOR = [
  '[class*="service-card" i]',
  '[class*="service-item" i]',
  '[class*="service-box" i]',
  '[class*="product-card" i]',
  '[class*="product-item" i]',
  '[class*="offering" i]',
  "article[class*='service' i]",
  "article[class*='product' i]",
  "li[class*='service' i]",
  "div[class*='services' i] > div",
  ".wp-block-column",
].join(", ");

const MAX_NAME = 70;

/** Headings that are page furniture rather than an offering. */
const NOT_AN_OFFERING =
  /^(our services|services|what we do|products|our products|our work|why choose us|about us|about|contact|contact us|testimonials|reviews|faq|frequently asked questions|get in touch|blog|news|home|menu|search|areas we serve|service areas|our team|meet the team|gallery|resources|get a quote|request a quote|free estimate|learn more|read more|see more|view all|next|previous|password protected|coming soon|page not found|privacy policy|terms of service)$/i;

/** Page furniture that reads like a name but is a tagline, CTA, or wrapper. */
const OFFERING_ANTIPATTERNS = [
  /^since\s+\d{4}$/i,
  // Unrendered CMS placeholders: "[state] Payroll Services".
  /[[\]{}]|\{\{/,
  // A sentence about a service, not its name: "We can simplify the payroll
  // process for you".
  /^(we|our|you|your|i|let|it|they|this|that)\b/i,
  /^free\b.*\b(estimate|quote|consultation|inspection)$/i,
  /^(tips|guide|how to|what|why|when|where)\b/i,
  /\b(now available|call us|click here)\b/i,
];

/** Prices as written. Never estimated — see prompts/02-offering-normalization.md. */
const PRICE =
  /(?:starting (?:at|from)|from|as low as)?\s*\$\s?[\d,]+(?:\.\d{2})?(?:\s*(?:\/|per\s)\s*\w+)?|\b(?:free estimate|free consultation|free quote|per project|per service call|per inspection|call for pricing|contact for pricing)\b/i;

export function extractOfferings(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];
  const seen = new Set<string>();

  const emit = (
    offering: ReturnType<typeof toOffering>,
    method: "dom" | "heuristic" = "dom",
    confidence = 0.65,
  ) => {
    const key = normalizeName(offering.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(evidence("offerings", offering, method, page, { confidence }));
  };

  // A services dropdown is the company's own catalogue, in its own words and in
  // its own order — the source prompt 02 is told to prefer. Extracting it turns
  // one home-page fetch into most of the offering list on a page-per-service
  // site, which is how every SMB site in the golden set is built.
  if (page.role === "home") {
    for (const item of navOfferings($, page.url)) emit(item, "dom", 0.6);
  }

  // A single-segment page that isn't one of the known roles is, on a small
  // business site, almost always one service: `/well-inspections/`,
  // `/pumping-systems/`, `/financing/`. Its `<h1>` is the offering's name.
  if (page.role === "other" && pathDepth(page.url) === 1) {
    const heading = $("h1").first().text().replace(/\s+/g, " ").trim();
    if (isOfferingName(heading)) {
      emit(
        toOffering({
          name: heading,
          description: firstParagraph($),
          features: [],
          pricing: null,
          url: page.url,
        }),
        "heuristic",
        0.5,
      );
    }
  }

  if (page.role !== "services" && page.role !== "products" && page.role !== "pricing") {
    void site;
    return out;
  }

  $(CARD_SELECTOR).each((_, element) => {
    const card = $(element);
    if (card.find(CARD_SELECTOR).length > 0) return;

    const heading = card.find("h1, h2, h3, h4, h5, h6").first().text().replace(/\s+/g, " ").trim();
    if (!isOfferingName(heading)) return;

    const description = findDescription(card, heading);
    const features = card
      .find("li")
      .map((_, item) => $(item).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((feature) => feature.length > 3 && feature.length < 160)
      .slice(0, 8);

    const href = card.find("a[href]").first().attr("href");
    const priceMatch = card.text().match(PRICE);

    emit(
      toOffering({
        name: heading,
        description,
        features,
        pricing: priceMatch ? priceMatch[0].replace(/\s+/g, " ").trim() : null,
        url: href ? (normalizeUrl(href, page.url) ?? null) : null,
      }),
    );
  });

  // Fallback for sites with no card markup at all: the page's own subheadings.
  if (out.length === 0) {
    $("h2, h3").each((_, element) => {
      const heading = $(element).text().replace(/\s+/g, " ").trim();
      if (!isOfferingName(heading)) return;

      const description = $(element)
        .nextAll("p")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();

      emit(
        toOffering({
          name: heading,
          description: description.length > 20 ? description.slice(0, 600) : null,
          features: [],
          pricing: null,
          url: null,
        }),
      );
    });
  }

  void site;
  return out.slice(0, 40);
}

/** Links nested under a "Services" / "Products" menu item. */
function navOfferings($: cheerio.CheerioAPI, pageUrl: string) {
  const items: Array<ReturnType<typeof toOffering>> = [];

  $("nav li, .menu li, ul li").each((_, element) => {
    const item = $(element);
    const label = item.children("a").first().text().replace(/\s+/g, " ").trim();
    if (!/^(our\s+)?(services|products|solutions|what we do)$/i.test(label)) return;

    const submenu = item.find("ul").first();
    if (submenu.length === 0) return;

    submenu.find("a[href]").each((__, link) => {
      const anchor = $(link);
      const name = anchor.text().replace(/\s+/g, " ").trim();
      if (!isOfferingName(name)) return;

      const href = anchor.attr("href");
      items.push(
        toOffering({
          name,
          description: null,
          features: [],
          pricing: null,
          url: href ? (normalizeUrl(href, pageUrl) ?? null) : null,
        }),
      );
    });
  });

  return items.slice(0, 30);
}

function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

function firstParagraph($: cheerio.CheerioAPI): string | null {
  const text = $("p").first().text().replace(/\s+/g, " ").trim();
  return text.length > 20 ? text.slice(0, 600) : null;
}

function isOfferingName(heading: string): boolean {
  if (!heading || heading.length > MAX_NAME || heading.length < 3) return false;
  if (NOT_AN_OFFERING.test(heading)) return false;
  if (OFFERING_ANTIPATTERNS.some((pattern) => pattern.test(heading))) return false;
  // A sentence is a claim about a service, not the name of one.
  if (/[.!?]$/.test(heading)) return false;
  if (heading.split(/\s+/).length > 9) return false;
  return /[A-Za-z]/.test(heading);
}

function findDescription(card: cheerio.Cheerio<AnyNode>, heading: string): string | null {
  const text = card
    .find("p")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (text && text !== heading && text.length > 20) return text.slice(0, 600);
  return null;
}

function toOffering(input: {
  name: string;
  description: string | null;
  features: string[];
  pricing: string | null;
  url: string | null;
}) {
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.65,
    sourceUrls: [],
    name: input.name,
    category: null,
    description: input.description,
    features: input.features,
    pricing: input.pricing,
    url: input.url,
    sourceCandidateIndexes: [],
  };
}

/** Key used to dedupe within a page and, later, across pages in the reconciler. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(services?|solutions?|systems?|company|inc|llc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
