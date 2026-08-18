import { z } from "zod";
import { sourced } from "./sourced";
import {
  addressSchema,
  brandColorSchema,
  mediaRefSchema,
  timestampSchema,
  urlSchema,
} from "./primitives";
import {
  aggregateRatingSchema,
  awardSchema,
  caseStudySchema,
  cadenceSchema,
  contentGapSchema,
  contentItemSchema,
  credentialSchema,
  faqSchema,
  glossaryTermSchema,
  guaranteeSchema,
  headlinePatternSchema,
  logoSchema,
  offeringSchema,
  personSchema,
  pressMentionSchema,
  seasonalSignalSchema,
  socialProfileSchema,
  taxonomySchema,
  testimonialSchema,
  themeSchema,
  trustStatSchema,
  writingStyleSchema,
} from "./entities";

/**
 * The knowledge base schema. This file is the single source of truth (R17):
 * every type in the app is inferred from it, so runtime validation and compile-time
 * types can never drift apart.
 *
 * Two conventions run through it:
 *
 * 1. **Everything is optional.** Across the 8 reference profiles, `yearFounded`
 *    appears 3 times and `revenue` once. A missing value is `Sourced<T>` with
 *    `value: null, method: "not-found"` — never an empty string, never a plausible
 *    default. See docs/DATA-QUALITY.md §2.
 * 2. **Scalars are wrapped, records carry their own provenance.** A scalar is
 *    `Sourced<T>`; a collection is `Sourced<T[]>` whose items each carry
 *    `RecordProvenance`. The collection envelope holds collection-level state such
 *    as "a review widget was detected but its content is JS-rendered"; the record
 *    envelope drives the per-card badge in docs/EDIT-UX.md §4.
 */

/* ------------------------------------------------------------- 1. foundation */

export const companyRoleSchema = z.enum([
  "manufacturer",
  "distributor",
  "retailer",
  "service-provider",
  "contractor",
  "agency",
  "broker",
  "consultancy",
  "software-vendor",
  "nonprofit",
  "other",
]);

export const businessModelSchema = z.enum([
  "b2b",
  "b2c",
  "b2b2c",
  "b2g",
  "marketplace",
  "mixed",
]);

export const foundationSchema = z.object({
  /** 2–3 sentence description of what the company does. AI-generated (prompt 01). */
  overview: sourced(z.string()),
  website: sourced(urlSchema),
  industry: sourced(z.string()),
  /** Who they sell to, as a controlled value; the prose lives in `overview`. */
  businessModel: sourced(businessModelSchema),
  companyRole: sourced(companyRoleSchema),
  yearFounded: sourced(z.number().int().min(1600).max(2100)),
  legalEntityType: sourced(z.string()),
  employeeCount: sourced(z.number().int().nonnegative()),
  /** Verbatim as published ("$5M–$10M"); never estimated. */
  revenue: sourced(z.string()),
  mainAddress: sourced(addressSchema),
  otherLocations: sourced(z.array(addressSchema)),
  /** Areas served, as named by the company ("Austin", "Central Texas"). */
  serviceLocations: sourced(z.array(z.string())),
  altNames: sourced(z.array(z.string())),
  phone: sourced(z.string()),
  email: sourced(z.string()),
});

export type Foundation = z.infer<typeof foundationSchema>;

/* ------------------------------------------------------------ 2. positioning */

export const positioningSchema = z.object({
  /** One-paragraph elevator pitch in the company's own voice. AI-generated. */
  pitch: sourced(z.string()),
  foundingStory: sourced(z.string()),
});

export type Positioning = z.infer<typeof positioningSchema>;

/* ----------------------------------------------------------------- 3. market */

export const marketSchema = z.object({
  buyers: sourced(z.array(z.string())),
  customerNeeds: sourced(z.string()),
  idealPersona: sourced(z.string()),
  industryGroupings: sourced(z.array(z.string())),
  industryOutlook: sourced(z.string()),
  /** Where they reach customers: organic search, referral, trade shows… */
  channels: sourced(z.array(z.string())),
  /** Conversion paths present on the site: quote form, phone, booking widget… */
  funnels: sourced(z.array(z.string())),
  /** Call-to-action copy found on the site, verbatim. */
  ctas: sourced(z.array(z.string())),
  /** Third-party vendors fingerprinted from script/iframe hosts. */
  suppliersPartners: sourced(z.array(z.string())),
});

export type Market = z.infer<typeof marketSchema>;

/* --------------------------------------------------------------- 4. branding */

export const brandingSchema = z.object({
  writingStyle: sourced(writingStyleSchema),
  artStyle: sourced(z.string()),
  fonts: sourced(z.array(z.string())),
  colors: sourced(z.array(brandColorSchema)),
  logos: sourced(z.array(logoSchema)),
});

export type Branding = z.infer<typeof brandingSchema>;

/* -------------------------------------------------------- 5. online presence */

export const onlinePresenceSchema = z.object({
  profiles: sourced(z.array(socialProfileSchema)),
});

export type OnlinePresence = z.infer<typeof onlinePresenceSchema>;

/* ------------------------------------------------------------------ 8. proof */

export const proofSchema = z.object({
  testimonials: sourced(z.array(testimonialSchema)),
  aggregateRatings: sourced(z.array(aggregateRatingSchema)),
  caseStudies: sourced(z.array(caseStudySchema)),
  certifications: sourced(z.array(credentialSchema)),
  memberships: sourced(z.array(credentialSchema)),
  awards: sourced(z.array(awardSchema)),
  pressMentions: sourced(z.array(pressMentionSchema)),
  trustStats: sourced(z.array(trustStatSchema)),
  guarantees: sourced(z.array(guaranteeSchema)),
  clientLogos: sourced(z.array(mediaRefSchema)),
});

export type Proof = z.infer<typeof proofSchema>;

/* ----------------------------------------------------- 9. content intelligence */

export const contentIntelligenceSchema = z.object({
  themes: sourced(z.array(themeSchema)),
  posts: sourced(z.array(contentItemSchema)),
  taxonomy: sourced(taxonomySchema),
  cadence: sourced(cadenceSchema),
  headlinePatterns: sourced(z.array(headlinePatternSchema)),
  faqs: sourced(z.array(faqSchema)),
  glossary: sourced(z.array(glossaryTermSchema)),
  seasonalSignals: sourced(z.array(seasonalSignalSchema)),
  contentGaps: sourced(z.array(contentGapSchema)),
});

export type ContentIntelligence = z.infer<typeof contentIntelligenceSchema>;

/* --------------------------------------------------------------- 10. quality */

/**
 * Not wrapped in `Sourced<T>`: this category is computed *about* the knowledge
 * base rather than extracted from the website, so provenance would be meaningless.
 */

export const categoryIdSchema = z.enum([
  "foundation",
  "positioning",
  "market",
  "branding",
  "onlinePresence",
  "people",
  "offerings",
  "proof",
  "contentIntelligence",
]);

export type CategoryId = z.infer<typeof categoryIdSchema>;

export const categoryScoreSchema = z.object({
  category: categoryIdSchema,
  /** Impact-weighted, 0–1. See docs/DATA-QUALITY.md §5. */
  score: z.number().min(0).max(1),
  filledFields: z.number().int().nonnegative(),
  totalFields: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
});

export const conflictCandidateSchema = z.object({
  value: z.unknown(),
  sourceUrl: urlSchema,
  /** Plain-language origin for the radio label: "on the Contact page". */
  sourceLabel: z.string(),
  confidence: z.number().min(0).max(1),
});

export const conflictSchema = z.object({
  path: z.string(),
  label: z.string(),
  /** Highest-precedence candidate first; the UI pre-selects index 0. */
  candidates: z.array(conflictCandidateSchema),
  resolved: z.boolean(),
});

export type Conflict = z.infer<typeof conflictSchema>;

export const followUpQuestionSchema = z.object({
  id: z.string(),
  /** Plain language, never the field name: "What year did you start?" */
  question: z.string(),
  example: z.string().nullable(),
  /** Field paths this answer fills. More than one when questions are grouped. */
  fills: z.array(z.string()),
  /** `(impact × substitutabilityPenalty) / answerCost` — docs/DATA-QUALITY.md §6. */
  priority: z.number(),
  answered: z.boolean(),
});

export type FollowUpQuestion = z.infer<typeof followUpQuestionSchema>;

export const qualitySchema = z.object({
  overallScore: z.number().min(0).max(1),
  categoryScores: z.array(categoryScoreSchema),
  /** Dot paths of fields that are genuinely empty. */
  missingFields: z.array(z.string()),
  conflicts: z.array(conflictSchema),
  /** Capped at 6. A longer list is a form, which is what we are avoiding. */
  followUpQuestions: z.array(followUpQuestionSchema),
});

export type Quality = z.infer<typeof qualitySchema>;

/* --------------------------------------------------------- scrape metadata */

/** Each code maps to a specific user-facing message — docs/DATA-QUALITY.md §7. */
export const warningCodeSchema = z.enum([
  "js-rendered",
  "widget-detected",
  "robots-disallow",
  "budget-exceeded",
  "fetch-failed",
  "non-html",
  "empty-body",
  "redirect-offsite",
  "bot-challenge",
]);

export type WarningCode = z.infer<typeof warningCodeSchema>;

export const scrapeWarningSchema = z.object({
  code: warningCodeSchema,
  /** Already written for the user; the UI renders it verbatim. */
  message: z.string(),
  url: urlSchema.nullable(),
});

export type ScrapeWarning = z.infer<typeof scrapeWarningSchema>;

export const pageRoleSchema = z.enum([
  "home",
  "about",
  "services",
  "products",
  "pricing",
  "contact",
  "team",
  "testimonials",
  "faq",
  "blog-index",
  "blog-post",
  "legal",
  "other",
]);

export type PageRole = z.infer<typeof pageRoleSchema>;

export const crawledPageSchema = z.object({
  url: urlSchema,
  role: pageRoleSchema,
  status: z.number().int(),
  bytes: z.number().int().nonnegative(),
  fetchedAt: timestampSchema,
});

export const scrapeMetadataSchema = z.object({
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
  durationMs: z.number().int().nonnegative(),
  pagesDiscovered: z.number().int().nonnegative(),
  pages: z.array(crawledPageSchema),
  robotsRespected: z.boolean(),
  warnings: z.array(scrapeWarningSchema),
  /** Bumped when extraction logic changes, so old saves stay interpretable. */
  scraperVersion: z.string(),
});

export type ScrapeMetadata = z.infer<typeof scrapeMetadataSchema>;

/* ------------------------------------------------------------- the whole KB */

export const knowledgeBaseSchema = z.object({
  id: z.string(),
  /** Incremented on every save; each version is written immutably. */
  version: z.number().int().min(1),
  companyName: sourced(z.string()),
  /** The URL the user submitted, normalized. */
  sourceUrl: urlSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  scrape: scrapeMetadataSchema,

  foundation: foundationSchema,
  positioning: positioningSchema,
  market: marketSchema,
  branding: brandingSchema,
  onlinePresence: onlinePresenceSchema,
  people: sourced(z.array(personSchema)),
  offerings: sourced(z.array(offeringSchema)),
  proof: proofSchema,
  contentIntelligence: contentIntelligenceSchema,
  quality: qualitySchema,
});

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

/**
 * The trimmed shape `/knowledge/view` lists, so the list route never ships full
 * knowledge bases to render a grid of cards (docs/VIEW-PAGE.md §Data loading).
 *
 * Two fields exist purely to keep that promise. `location` is on the card and in
 * the table, and digging it out of `foundation.mainAddress` would mean shipping
 * the foundation category. `keywords` is what makes search match the things a
 * person actually recalls — an offering name, somebody on the team — without
 * shipping fourteen offerings per record to search them.
 */
export const knowledgeBaseSummarySchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  companyName: z.string().nullable(),
  sourceUrl: urlSchema,
  industry: z.string().nullable(),
  logoUrl: urlSchema.nullable(),
  /** "Dripping Springs, TX" — the line under the company name on a card. */
  location: z.string().nullable(),
  completeness: z.number().min(0).max(1),
  peopleCount: z.number().int().nonnegative(),
  offeringsCount: z.number().int().nonnegative(),
  testimonialsCount: z.number().int().nonnegative(),
  /** Fields still in the attention tier — the card's "needs review" line. */
  attentionCount: z.number().int().nonnegative(),
  /** Unresolved conflicts. A subset of `attentionCount`, filtered separately. */
  conflictCount: z.number().int().nonnegative(),
  /** Extra search terms: alt names, areas served, offering and people names. */
  keywords: z.array(z.string()),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type KnowledgeBaseSummary = z.infer<typeof knowledgeBaseSummarySchema>;

/** Human-readable category names for the left rail and section headers. */
export const CATEGORY_LABELS: Record<CategoryId, string> = {
  foundation: "Company foundation",
  positioning: "Positioning",
  market: "Market & customers",
  branding: "Brand",
  onlinePresence: "Online presence",
  people: "Key people",
  offerings: "Products & services",
  proof: "Proof & credibility",
  contentIntelligence: "Content",
};

export const CATEGORY_ORDER = categoryIdSchema.options;
