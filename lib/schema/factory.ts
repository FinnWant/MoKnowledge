import { notFound } from "./sourced";
import type { KnowledgeBase, Quality, ScrapeMetadata } from "./knowledge-base";

/**
 * Bumped whenever extraction logic changes shape, so a knowledge base saved by an
 * older build stays interpretable rather than silently mis-read.
 */
export const SCRAPER_VERSION = "0.1.0";

/** Stable ID for a knowledge base or a record inside one. */
export function newId(): string {
  return crypto.randomUUID();
}

function emptyScrapeMetadata(now: string): ScrapeMetadata {
  return {
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    pagesDiscovered: 0,
    pages: [],
    robotsRespected: true,
    warnings: [],
    scraperVersion: SCRAPER_VERSION,
  };
}

function emptyQuality(): Quality {
  return {
    overallScore: 0,
    categoryScores: [],
    missingFields: [],
    conflicts: [],
    followUpQuestions: [],
  };
}

/**
 * A schema-valid knowledge base with every field in the `not-found` state.
 *
 * The reconciler starts here and fills fields in, which is what guarantees the
 * invariant from docs/DATA-QUALITY.md §2: a field the extractors never touched is
 * explicitly "we looked and found nothing", not an absent key or an empty string.
 */
export function createEmptyKnowledgeBase(input: {
  id?: string;
  sourceUrl: string;
  now?: string;
}): KnowledgeBase {
  const now = input.now ?? new Date().toISOString();

  return {
    id: input.id ?? newId(),
    version: 1,
    companyName: notFound(),
    sourceUrl: input.sourceUrl,
    createdAt: now,
    updatedAt: now,
    scrape: emptyScrapeMetadata(now),

    foundation: {
      overview: notFound(),
      website: notFound(),
      industry: notFound(),
      businessModel: notFound(),
      companyRole: notFound(),
      yearFounded: notFound(),
      legalEntityType: notFound(),
      employeeCount: notFound(),
      revenue: notFound(),
      mainAddress: notFound(),
      otherLocations: notFound(),
      serviceLocations: notFound(),
      altNames: notFound(),
      phone: notFound(),
      email: notFound(),
    },

    positioning: {
      pitch: notFound(),
      foundingStory: notFound(),
    },

    market: {
      buyers: notFound(),
      customerNeeds: notFound(),
      idealPersona: notFound(),
      industryGroupings: notFound(),
      industryOutlook: notFound(),
      channels: notFound(),
      funnels: notFound(),
      ctas: notFound(),
      suppliersPartners: notFound(),
    },

    branding: {
      writingStyle: notFound(),
      artStyle: notFound(),
      fonts: notFound(),
      colors: notFound(),
      logos: notFound(),
    },

    onlinePresence: {
      profiles: notFound(),
    },

    people: notFound(),
    offerings: notFound(),

    proof: {
      testimonials: notFound(),
      aggregateRatings: notFound(),
      caseStudies: notFound(),
      certifications: notFound(),
      memberships: notFound(),
      awards: notFound(),
      pressMentions: notFound(),
      trustStats: notFound(),
      guarantees: notFound(),
      clientLogos: notFound(),
    },

    contentIntelligence: {
      themes: notFound(),
      posts: notFound(),
      taxonomy: notFound(),
      cadence: notFound(),
      headlinePatterns: notFound(),
      faqs: notFound(),
      glossary: notFound(),
      seasonalSignals: notFound(),
      contentGaps: notFound(),
    },

    quality: emptyQuality(),
  };
}
