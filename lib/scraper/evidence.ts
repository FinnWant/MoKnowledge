import type { ExtractionMethod, PageRole } from "@/lib/schema";

/**
 * The common currency of extraction.
 *
 * Every extractor returns `Evidence[]` — a claim about one field, with where it
 * came from and how it was found. Extractors never write into the knowledge base
 * directly, which is what lets the reconciler resolve competing claims by
 * precedence instead of by whichever extractor happened to run last.
 */

/**
 * How a claim was found, in descending order of trust.
 *
 * `microdata` is absent on purpose. ROADMAP §5.3 planned for it as the second
 * tier, but zero of the 133 pages across the seven captured golden sites use
 * `itemtype="https://schema.org/…"`, while six of seven sites emit JSON-LD and
 * all seven emit OpenGraph. Implementing a tier no real site uses would be
 * speculative work dressed up as thoroughness.
 */
export type EvidenceMethod =
  | "json-ld"
  | "opengraph"
  | "meta"
  | "dom"
  | "heuristic"
  | "computed";

/**
 * Base confidence by method. The reconciler resolves ties with these, and an
 * extractor may lower its own claim below the base when it is unsure.
 */
export const METHOD_CONFIDENCE: Record<EvidenceMethod, number> = {
  "json-ld": 0.95,
  opengraph: 0.85,
  meta: 0.8,
  dom: 0.65,
  heuristic: 0.45,
  computed: 0.7,
};

/** Precedence tier. Higher always wins, regardless of confidence. */
export const METHOD_TIER: Record<EvidenceMethod, number> = {
  "json-ld": 5,
  opengraph: 4,
  meta: 4,
  computed: 3,
  dom: 2,
  heuristic: 1,
};

/**
 * How much a page's role vouches for a claim found on it. A phone number on the
 * contact page beats the same field scraped from a blog post.
 */
export const ROLE_WEIGHT: Record<PageRole, number> = {
  contact: 1.0,
  about: 0.98,
  home: 0.95,
  team: 0.9,
  services: 0.88,
  products: 0.88,
  pricing: 0.85,
  testimonials: 0.85,
  faq: 0.8,
  legal: 0.75,
  "blog-index": 0.6,
  "blog-post": 0.55,
  other: 0.7,
};

export type Evidence<T = unknown> = {
  /** Dot path into the knowledge base, e.g. `foundation.yearFounded`. */
  path: string;
  value: T;
  method: EvidenceMethod;
  sourceUrl: string;
  sourceRole: PageRole;
  /** 0–1. Defaults to the method's base; extractors lower it when unsure. */
  confidence: number;
  /** Why this claim is uncertain, carried through to the field's `note`. */
  note?: string;
};

export function evidence<T>(
  path: string,
  value: T,
  method: EvidenceMethod,
  page: { url: string; role: PageRole },
  options: { confidence?: number; note?: string } = {},
): Evidence<T> {
  return {
    path,
    value,
    method,
    sourceUrl: page.url,
    sourceRole: page.role,
    confidence: options.confidence ?? METHOD_CONFIDENCE[method],
    ...(options.note ? { note: options.note } : {}),
  };
}

/** Effective score used to rank competing claims within a precedence tier. */
export function evidenceScore(item: Evidence): number {
  return item.confidence * ROLE_WEIGHT[item.sourceRole];
}

/** The `Sourced<T>.method` an extraction method maps to in the saved KB. */
export function toExtractionMethod(method: EvidenceMethod): ExtractionMethod {
  return method === "computed" ? "derived" : "scraped";
}

/** Plain-language origin for a conflict radio label, e.g. "on the Contact page". */
export function sourceLabel(item: Evidence): string {
  const LABELS: Record<PageRole, string> = {
    home: "on the home page",
    about: "on the About page",
    contact: "on the Contact page",
    services: "on the Services page",
    products: "on the Products page",
    pricing: "on the Pricing page",
    team: "on the Team page",
    testimonials: "on the Reviews page",
    faq: "on the FAQ page",
    "blog-index": "on the blog",
    "blog-post": "in a blog post",
    legal: "in the site's legal pages",
    other: "on the website",
  };
  return LABELS[item.sourceRole];
}

/** A page as the extractors see it. */
export type PageInput = {
  url: string;
  role: PageRole;
  html: string;
};

/** An extractor: pure, page-in, claims-out, never throws. */
export type Extractor = (page: PageInput, site: SiteContext) => Evidence[];

/** Whole-site facts an extractor may need while looking at one page. */
export type SiteContext = {
  originUrl: string;
  /** Registrable domain, for deciding whether a link is off-site. */
  domain: string;
};
