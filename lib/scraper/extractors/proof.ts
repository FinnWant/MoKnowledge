import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { detectReviewWidgets } from "../detect";
import { newId } from "@/lib/schema";
import { visibleText } from "./contact";

/**
 * Trust signals from the DOM: testimonials, credentials, trust stats,
 * guarantees, and press mentions.
 *
 * These are the signals docs/SCHEMA-EXTENSIONS.md showed the reference output
 * already harvesting and then losing — testimonials paraphrased into person
 * bios with the quotes discarded, press mentions filed under `Funnels`,
 * "over 40 years" dissolved into pitch prose. Extracting them into their own
 * shapes is the point of the `proof` category.
 */

/* ----------------------------------------------------------- testimonials */

const TESTIMONIAL_CONTAINER =
  '[class*="testimonial" i], [class*="review" i], [id*="testimonial" i], [class*="quote" i], blockquote';

/** Quotes shorter than this are pull-quotes or headings, not testimonials. */
const MIN_QUOTE = 40;
const MAX_QUOTE = 900;

/** An attribution line: "— Karen M., Spicewood TX". */
const ATTRIBUTION = /^[—–-]{0,2}\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s*(?:[,|–—-]\s*(.{2,60}))?$/;

export function extractProof(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];
  const text = visibleText($);

  /* -------------------------------------------------- review widgets */

  for (const widget of detectReviewWidgets(page.html)) {
    // The honest-failure path from docs/DATA-QUALITY.md §7. Naming the widget
    // is what makes the message actionable instead of "no testimonials found".
    out.push(
      evidence("proof.testimonials", [], "dom", page, {
        confidence: 0,
        note: `${widget} review widget detected at ${pathOf(page.url)}; its content is JS-rendered and not accessible to the static scraper`,
      }),
    );
  }

  /* --------------------------------------------------- on-page quotes */

  const seenQuotes = new Set<string>();
  $(TESTIMONIAL_CONTAINER).each((_, element) => {
    const container = $(element);
    // Skip a wrapper whose children are themselves testimonial blocks, or the
    // same quote gets claimed once per nesting level.
    if (container.find(TESTIMONIAL_CONTAINER).length > 0) return;

    const raw = container.text().replace(/\s+/g, " ").trim();
    const quote = cleanQuote(raw);
    if (!quote) return;

    const key = quoteKey(quote);
    if (seenQuotes.has(key)) return;
    seenQuotes.add(key);

    const attribution = findAttribution($, container);
    const rating = findRating($, container);

    out.push(
      evidence(
        "proof.testimonials",
        {
          id: newId(),
          method: "scraped" as const,
          confidence: 0.7,
          sourceUrls: [],
          quote,
          authorName: attribution?.name ?? null,
          authorRole: attribution?.role ?? null,
          authorCompany: null,
          authorLocation: null,
          rating,
          date: null,
          platform: null,
          mediaUrl: null,
          topics: [],
          mentionsPeople: [],
          mentionsOfferings: [],
        },
        "dom",
        page,
        { confidence: 0.7 },
      ),
    );
  });

  /* ---------------------------------------------------- trust stats */

  for (const stat of extractTrustStats(text)) {
    out.push(evidence("proof.trustStats", stat, "heuristic", page, { confidence: 0.6 }));
  }

  /* ---------------------------------------------------- credentials */

  for (const credential of extractCredentials(text)) {
    const path =
      credential.kind === "membership" ? "proof.memberships" : "proof.certifications";
    out.push(evidence(path, credential, "heuristic", page, { confidence: 0.6 }));
  }

  /* ----------------------------------------------------- guarantees */

  for (const guarantee of extractGuarantees(text)) {
    out.push(evidence("proof.guarantees", guarantee, "heuristic", page, { confidence: 0.65 }));
  }

  void site;
  return out;
}

function cleanQuote(raw: string): string | null {
  const quote = raw
    .replace(/^["“”'']+|["“”'']+$/g, "")
    .replace(/\s*[—–-]\s*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s*$/, "")
    .trim();

  if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE) return null;
  // A real testimonial is a sentence. Nav blocks and card grids are not.
  if (!/[.!?]/.test(quote)) return null;
  if (/\b(cookie|privacy policy|all rights reserved|©)\b/i.test(quote)) return null;
  return quote;
}

/** Normalized key for cross-page dedupe: sliders repeat on every page. */
export function quoteKey(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function findAttribution(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
): { name: string; role: string | null } | null {
  const candidates = [
    container.find("cite, footer, [class*='author' i], [class*='name' i]").first().text(),
    container.next("cite, figcaption, [class*='author' i]").text(),
  ];

  for (const candidate of candidates) {
    const line = candidate.replace(/\s+/g, " ").trim();
    if (!line || line.length > 80) continue;
    const match = line.match(ATTRIBUTION);
    if (match) return { name: match[1].trim(), role: match[2]?.trim() ?? null };
  }
  return null;
}

function findRating(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
): number | null {
  const label =
    container.find("[aria-label*='out of' i]").attr("aria-label") ??
    container.attr("aria-label");
  const match = label?.match(/([\d.]+)\s*(?:out of|\/)\s*([\d.]+)/i);
  if (match) {
    const value = Number(match[1]);
    const best = Number(match[2]);
    if (Number.isFinite(value) && best === 5) return value;
  }

  const stars = container.find("[class*='star' i]").length;
  return stars >= 5 ? 5 : null;
}

/* ------------------------------------------------------------ trust stats */

type StatPattern = {
  pattern: RegExp;
  category:
    | "years-in-business"
    | "customers-served"
    | "projects-completed"
    | "volume-transacted"
    | "team-size"
    | "response-time"
    | "other";
  unit: string;
};

const STAT_PATTERNS: StatPattern[] = [
  {
    pattern:
      /\b(?:over|more than|nearly|almost)?\s*(\d{1,3}|a|one)\+?\s*(?:years?|decades?)\s+(?:of\s+)?(?:experience|in business|serving|of service)/gi,
    category: "years-in-business",
    unit: "years",
  },
  {
    pattern: /\bsince\s+((?:19|20)\d{2})\b/gi,
    category: "years-in-business",
    unit: "year",
  },
  {
    pattern:
      /\b(?:over|more than|nearly)?\s*([\d,]{2,10})\+?\s+(?:satisfied\s+)?(?:customers|clients|homeowners|families|businesses)\b/gi,
    category: "customers-served",
    unit: "customers",
  },
  {
    pattern:
      /\b(?:over|more than|nearly)?\s*([\d,]{2,10})\+?\s+(?:projects|jobs|wells|installations|homes|systems|inspections)\s+(?:completed|drilled|installed|served|sold)?/gi,
    category: "projects-completed",
    unit: "projects",
  },
  {
    pattern:
      /\b(?:over|more than|nearly)?\s*\$\s*([\d.,]+)\s*(billion|million|B|M)\b[^.]{0,40}/gi,
    category: "volume-transacted",
    unit: "currency",
  },
];

export function extractTrustStats(text: string) {
  const stats: Array<{
    id: string;
    method: "scraped";
    confidence: number;
    sourceUrls: string[];
    claim: string;
    value: number | null;
    unit: string | null;
    category: StatPattern["category"];
    asOfDate: null;
  }> = [];
  const seen = new Set<string>();

  for (const { pattern, category, unit } of STAT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const claim = match[0].replace(/\s+/g, " ").trim();
      const key = claim.toLowerCase();
      if (seen.has(key) || claim.length > 90) continue;
      seen.add(key);

      const raw = match[1]?.replace(/,/g, "");
      const value =
        raw === "a" || raw === "one" ? 1 : raw && Number.isFinite(Number(raw)) ? Number(raw) : null;

      stats.push({
        id: newId(),
        method: "scraped",
        confidence: 0.6,
        sourceUrls: [],
        claim,
        value,
        unit,
        category,
        asOfDate: null,
      });
      if (stats.length >= 12) return stats;
    }
  }
  return stats;
}

/* ------------------------------------------------------------ credentials */

type CredentialPattern = {
  pattern: RegExp;
  name: string;
  issuer: string | null;
  kind: "license" | "certification" | "membership" | "accreditation";
};

/**
 * A dictionary rather than a general rule, because "certified" appears in
 * marketing copy far more often than it appears next to an actual credential.
 * A named body is the only reliable signal at this level of effort.
 */
const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  { pattern: /\bCPA\b|\bCertified Public Accountant\b/, name: "Certified Public Accountant (CPA)", issuer: null, kind: "certification" },
  { pattern: /\bAICPA\b|American Institute of (Certified Public Accountants|CPAs)/, name: "AICPA", issuer: "American Institute of CPAs", kind: "membership" },
  { pattern: /QuickBooks\s+(Certified\s+)?ProAdvisor/i, name: "QuickBooks Certified ProAdvisor", issuer: "Intuit", kind: "certification" },
  { pattern: /\bNGWA\b|National Ground ?Water Association/i, name: "National Ground Water Association (NGWA)", issuer: "NGWA", kind: "membership" },
  { pattern: /\bBBB\b|Better Business Bureau/i, name: "Better Business Bureau", issuer: "BBB", kind: "accreditation" },
  { pattern: /\bLEED\b\s*(certified|accredited)?/i, name: "LEED", issuer: "USGBC", kind: "certification" },
  { pattern: /\bNATE[- ]certified\b/i, name: "NATE Certified", issuer: "North American Technician Excellence", kind: "certification" },
  { pattern: /\bASE[- ]certified\b/i, name: "ASE Certified", issuer: "National Institute for Automotive Service Excellence", kind: "certification" },
  { pattern: /\bEPA[- ]certified\b/i, name: "EPA Certified", issuer: "Environmental Protection Agency", kind: "certification" },
  { pattern: /\bRealtor®|\bNAR\b|National Association of Realtors/i, name: "National Association of Realtors", issuer: "NAR", kind: "membership" },
  { pattern: /\bMLS\b/, name: "Multiple Listing Service", issuer: null, kind: "membership" },
  { pattern: /Chamber of Commerce/i, name: "Chamber of Commerce", issuer: null, kind: "membership" },
];

/** State licence numbers: "TX #12345", "License No. 4821", "Lic# 9931". */
const LICENSE_NUMBER = /\b(?:license|licence|lic\.?|reg(?:istration)?\.?)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z]{0,3}[-\s]?\d{3,8})\b/gi;

export function extractCredentials(text: string) {
  const found: Array<{
    id: string;
    method: "scraped";
    confidence: number;
    sourceUrls: string[];
    name: string;
    issuer: string | null;
    identifier: string | null;
    validUntil: null;
    verifyUrl: null;
    kind: CredentialPattern["kind"];
  }> = [];
  const seen = new Set<string>();

  for (const entry of CREDENTIAL_PATTERNS) {
    if (!entry.pattern.test(text)) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    found.push({
      id: newId(),
      method: "scraped",
      confidence: 0.6,
      sourceUrls: [],
      name: entry.name,
      issuer: entry.issuer,
      identifier: null,
      validUntil: null,
      verifyUrl: null,
      kind: entry.kind,
    });
  }

  LICENSE_NUMBER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LICENSE_NUMBER.exec(text)) !== null) {
    const identifier = match[1].trim();
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    found.push({
      id: newId(),
      method: "scraped",
      confidence: 0.55,
      sourceUrls: [],
      name: `License ${identifier}`,
      issuer: null,
      identifier,
      validUntil: null,
      verifyUrl: null,
      kind: "license",
    });
    if (found.length >= 12) break;
  }

  return found;
}

/* ------------------------------------------------------------- guarantees */

const GUARANTEE_PATTERNS: Array<{
  pattern: RegExp;
  kind: "warranty" | "satisfaction" | "licensing" | "insurance" | "bonding";
}> = [
  // The single most common SMB trust phrase, in all its orderings.
  { pattern: /\b(?:fully\s+)?licensed(?:,)?\s*(?:and\s+)?(?:bonded)?(?:,)?\s*(?:and\s+)?insured\b/i, kind: "licensing" },
  { pattern: /\b(?:100%\s*)?satisfaction guarantee(?:d)?\b/i, kind: "satisfaction" },
  { pattern: /\bmoney[- ]back guarantee\b/i, kind: "satisfaction" },
  { pattern: /\b(\d+)[- ]year (?:warranty|guarantee)\b/i, kind: "warranty" },
  { pattern: /\blifetime (?:warranty|guarantee)\b/i, kind: "warranty" },
  { pattern: /\bfully insured\b/i, kind: "insurance" },
  { pattern: /\bbonded\b/i, kind: "bonding" },
];

export function extractGuarantees(text: string) {
  const found: Array<{
    id: string;
    method: "scraped";
    confidence: number;
    sourceUrls: string[];
    text: string;
    kind: "warranty" | "satisfaction" | "licensing" | "insurance" | "bonding";
    terms: null;
  }> = [];
  const seen = new Set<string>();

  for (const { pattern, kind } of GUARANTEE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = match[0].replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    // "licensed, bonded, and insured" already covers the bare "bonded" match.
    if (kind === "bonding" && [...seen].some((entry) => entry.includes("bonded"))) continue;
    seen.add(key);
    found.push({
      id: newId(),
      method: "scraped",
      confidence: 0.65,
      sourceUrls: [],
      text: value,
      kind,
      terms: null,
    });
  }
  return found;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
