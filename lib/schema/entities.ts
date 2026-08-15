import { z } from "zod";
import { mediaRefSchema, record, urlSchema } from "./primitives";

/* ------------------------------------------------------------------ people */

export const personRoleSchema = z.enum([
  "owner",
  "executive",
  "manager",
  "staff",
  "advisor",
  "unknown",
]);

export const personSchema = record({
  name: z.string(),
  title: z.string().nullable(),
  role: personRoleSchema.nullable(),
  /**
   * Present because the reference outputs carry it. Always an inference from
   * name and pronouns, never a claim — it ships at low confidence and lands in
   * the review tier so a human confirms it.
   */
  gender: z.enum(["male", "female", "unknown"]).nullable(),
  bio: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  imageUrl: urlSchema.nullable(),
  profileUrl: urlSchema.nullable(),
  linkedin: urlSchema.nullable(),
});

export type Person = z.infer<typeof personSchema>;

/* -------------------------------------------------------------- offerings */

/**
 * Controlled vocabulary, matching the enum in prompts/02-offering-normalization.md.
 * The reference profiles use free-text categories (`Service`, `Business Services`,
 * `System Installation`, `Financial Service` in one document), which makes the
 * field unusable for filtering — this fixes that, with `other` as the escape hatch.
 */
export const offeringCategorySchema = z.enum([
  "product",
  "service",
  "package",
  "subscription",
  "consultation",
  "financing",
  "industry-solution",
  "other",
]);

export const offeringSchema = record({
  name: z.string(),
  category: offeringCategorySchema.nullable(),
  description: z.string().nullable(),
  features: z.array(z.string()),
  /** Verbatim as stated, qualifiers included ("starting at $250"). Never estimated. */
  pricing: z.string().nullable(),
  url: urlSchema.nullable(),
  /**
   * Indexes into the extractor's candidate list that were merged to produce this
   * offering. Makes a consolidation auditable and reversible in the edit UI
   * ("merged from 4 mentions") — see prompts/02-offering-normalization.md.
   */
  sourceCandidateIndexes: z.array(z.number().int().nonnegative()),
});

export type Offering = z.infer<typeof offeringSchema>;

/* ------------------------------------------------------------------ proof */

export const testimonialSchema = record({
  quote: z.string(),
  authorName: z.string().nullable(),
  authorRole: z.string().nullable(),
  authorCompany: z.string().nullable(),
  authorLocation: z.string().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  date: z.string().nullable(),
  /** Google, Birdeye, Trustpilot, Yelp, or `null` for an on-page quote. */
  platform: z.string().nullable(),
  mediaUrl: urlSchema.nullable(),
  topics: z.array(z.string()),
  /** `people[].id` — the link the reference outputs discarded when they */
  /** paraphrased testimonials into person bios. */
  mentionsPeople: z.array(z.string()),
  /** `offerings[].id`. */
  mentionsOfferings: z.array(z.string()),
});

export type Testimonial = z.infer<typeof testimonialSchema>;

export const aggregateRatingSchema = record({
  platform: z.string(),
  ratingValue: z.number(),
  bestRating: z.number().nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
});

export type AggregateRating = z.infer<typeof aggregateRatingSchema>;

export const caseStudySchema = record({
  title: z.string(),
  client: z.string().nullable(),
  problem: z.string().nullable(),
  solution: z.string().nullable(),
  results: z.array(z.string()),
  metrics: z.array(z.string()),
  url: urlSchema.nullable(),
});

export type CaseStudy = z.infer<typeof caseStudySchema>;

export const credentialKindSchema = z.enum([
  "license",
  "certification",
  "membership",
  "accreditation",
]);

export const credentialSchema = record({
  name: z.string(),
  issuer: z.string().nullable(),
  identifier: z.string().nullable(),
  validUntil: z.string().nullable(),
  verifyUrl: urlSchema.nullable(),
  kind: credentialKindSchema,
});

export type Credential = z.infer<typeof credentialSchema>;

export const awardSchema = record({
  name: z.string(),
  issuer: z.string().nullable(),
  year: z.number().int().nullable(),
});

export type Award = z.infer<typeof awardSchema>;

export const pressMentionSchema = record({
  outlet: z.string(),
  title: z.string().nullable(),
  url: urlSchema.nullable(),
  date: z.string().nullable(),
  kind: z.enum(["feature", "quote", "listing"]),
});

export type PressMention = z.infer<typeof pressMentionSchema>;

export const trustStatCategorySchema = z.enum([
  "years-in-business",
  "customers-served",
  "projects-completed",
  "volume-transacted",
  "team-size",
  "response-time",
  "other",
]);

export const trustStatSchema = record({
  /** The claim as written: "over 40 years", "$8.5B in sales". */
  claim: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  category: trustStatCategorySchema,
  asOfDate: z.string().nullable(),
});

export type TrustStat = z.infer<typeof trustStatSchema>;

export const guaranteeSchema = record({
  text: z.string(),
  kind: z.enum(["warranty", "satisfaction", "licensing", "insurance", "bonding"]),
  terms: z.string().nullable(),
});

export type Guarantee = z.infer<typeof guaranteeSchema>;

/* ----------------------------------------------------- content intelligence */

export const themeSchema = record({
  label: z.string(),
  /** 0–1, relative prominence across the crawled corpus. */
  weight: z.number().min(0).max(1),
  terms: z.array(z.string()),
  exampleUrls: z.array(urlSchema),
});

export type Theme = z.infer<typeof themeSchema>;

export const contentItemSchema = record({
  title: z.string(),
  url: urlSchema,
  publishedAt: z.string().nullable(),
  author: z.string().nullable(),
  category: z.string().nullable(),
  excerpt: z.string().nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  headings: z.array(z.string()),
});

export type ContentItem = z.infer<typeof contentItemSchema>;

export const taxonomySchema = z.object({
  categories: z.array(z.string()),
  tags: z.array(z.string()),
});

export const cadenceSchema = z.object({
  postsPerMonth: z.number().nonnegative().nullable(),
  firstPublished: z.string().nullable(),
  lastPublished: z.string().nullable(),
  daysSinceLast: z.number().int().nonnegative().nullable(),
  /** >90 days since the last post. A direct MoBlogs sales trigger. */
  isStale: z.boolean(),
});

export type Cadence = z.infer<typeof cadenceSchema>;

export const headlinePatternSchema = record({
  pattern: z.enum([
    "how-to",
    "listicle",
    "question",
    "comparison",
    "local-service",
    "seasonal",
    "announcement",
    "other",
  ]),
  count: z.number().int().nonnegative(),
  examples: z.array(z.string()),
});

export type HeadlinePattern = z.infer<typeof headlinePatternSchema>;

export const faqSchema = record({
  question: z.string(),
  answer: z.string(),
  topic: z.string().nullable(),
});

export type Faq = z.infer<typeof faqSchema>;

export const glossaryTermSchema = record({
  term: z.string(),
  definition: z.string(),
});

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

export const seasonalSignalSchema = record({
  label: z.string(),
  period: z.string().nullable(),
  text: z.string().nullable(),
});

export type SeasonalSignal = z.infer<typeof seasonalSignalSchema>;

export const contentGapSchema = record({
  topic: z.string(),
  reason: z.string(),
  /** `offerings[].id` this gap relates to, when it came from offering coverage. */
  relatedOffering: z.string().nullable(),
});

export type ContentGap = z.infer<typeof contentGapSchema>;

/* --------------------------------------------------------------- branding */

/**
 * Structured rather than prose, because MoSocial/MoMail/MoBlogs need to
 * condition on tone programmatically. `description` is the human-readable part;
 * the rest is machine-usable. Matches prompts/03-writing-style.md.
 */
export const toneSchema = z.enum([
  "authoritative",
  "warm",
  "professional",
  "conversational",
  "technical",
  "reassuring",
  "urgent",
  "aspirational",
  "educational",
  "direct",
  "playful",
  "formal",
]);

export const writingStyleSchema = z.object({
  description: z.string(),
  tone: z.array(toneSchema),
  formality: z.enum(["casual", "neutral", "formal"]),
  readerAddress: z.enum(["second-person", "third-person", "mixed"]),
  preferredTerms: z.array(z.string()),
  avoidTerms: z.array(z.string()),
  ctaStyle: z.string().nullable(),
});

export type WritingStyle = z.infer<typeof writingStyleSchema>;

/** A logo is a `MediaRef` with `kind: "logo"`; aliased for readability at the call site. */
export const logoSchema = mediaRefSchema;
export type Logo = z.infer<typeof mediaRefSchema>;

/* --------------------------------------------------------- online presence */

export const socialPlatformSchema = z.enum([
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "youtube",
  "tiktok",
  "pinterest",
  "yelp",
  "google-business",
  "other",
]);

export const socialProfileSchema = record({
  platform: socialPlatformSchema,
  url: urlSchema,
  handle: z.string().nullable(),
});

export type SocialProfile = z.infer<typeof socialProfileSchema>;
