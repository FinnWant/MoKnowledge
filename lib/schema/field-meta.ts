import type { CategoryId } from "./knowledge-base";

/**
 * Static metadata about every field in the knowledge base.
 *
 * This registry is what turns the schema into a product. It carries three things
 * the zod schema deliberately does not:
 *
 * - `impact` — how much generated content degrades without this field. Drives the
 *   impact-weighted completeness score (docs/DATA-QUALITY.md §5), because raw fill
 *   rate reads "42% complete" when the missing 58% is `revenue` and `employeeCount`.
 * - `askable` + `question` — whether a gap is worth putting to the customer, and
 *   the plain-language wording to use. Nobody should be asked for their own
 *   Flesch-Kincaid grade.
 * - `kind` — which of the eight editors from docs/EDIT-UX.md §4 renders it, so the
 *   UI never grows a bespoke component per field.
 */

/** The eight editors from docs/EDIT-UX.md §4, plus `composite` for structured scalars. */
export type FieldKind =
  | "text"
  | "prose"
  | "chips"
  | "color"
  | "link"
  | "enum"
  | "number"
  | "records"
  | "composite";

export type FieldMeta = {
  /** Dot path into the knowledge base, e.g. `foundation.yearFounded`. */
  path: string;
  category: CategoryId;
  /** Plain-language name shown to the user. Never the schema key. */
  label: string;
  kind: FieldKind;
  /** 1–5. How badly generated content suffers without it. */
  impact: 1 | 2 | 3 | 4 | 5;
  /**
   * Whether the customer plausibly knows the answer. `false` excludes the field
   * from the completeness denominator entirely — derived and external fields are
   * not the customer's failure to report.
   */
  askable: boolean;
  /** 1 = knows it instantly · 2 = a moment's thought · 3 = real work. */
  answerCost: 1 | 2 | 3;
  /** Plain-language prompt used when the field is empty. */
  question?: string;
  example?: string;
  /**
   * Sibling fields that mostly cover this one. A missing `overview` matters less
   * when `pitch` exists, so the gap ranks lower.
   */
  substitutes?: string[];
  /** Questions sharing a group are asked together as one prompt. */
  group?: string;
};

/** Multiplier applied when a substitute field is already filled. */
export const SUBSTITUTABILITY_PENALTY = 0.3;

/** Hard ceiling on follow-up questions. More than this is a form. */
export const MAX_FOLLOW_UP_QUESTIONS = 6;

export const FIELD_META: readonly FieldMeta[] = [
  /* ------------------------------------------------------------ foundation */
  {
    path: "companyName",
    category: "foundation",
    label: "Company name",
    kind: "text",
    impact: 5,
    askable: true,
    answerCost: 1,
    question: "What's the business called?",
  },
  {
    path: "foundation.overview",
    category: "foundation",
    label: "What the business does",
    kind: "prose",
    impact: 5,
    askable: true,
    answerCost: 2,
    question: "In a sentence or two, what does the business do?",
    substitutes: ["positioning.pitch"],
  },
  {
    path: "foundation.website",
    category: "foundation",
    label: "Website",
    kind: "link",
    impact: 5,
    askable: true,
    answerCost: 1,
    question: "What's the website address?",
  },
  {
    path: "foundation.industry",
    category: "foundation",
    label: "Industry",
    kind: "text",
    impact: 5,
    askable: true,
    answerCost: 1,
    question: "What industry are you in?",
    example: "Well drilling",
  },
  {
    path: "foundation.businessModel",
    category: "foundation",
    label: "Who you sell to",
    kind: "enum",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Do you mostly serve other businesses, or the general public?",
  },
  {
    path: "foundation.companyRole",
    category: "foundation",
    label: "Type of business",
    kind: "enum",
    impact: 3,
    askable: true,
    answerCost: 1,
    question: "Which best describes the business?",
    example: "Contractor",
  },
  {
    path: "foundation.yearFounded",
    category: "foundation",
    label: "Year founded",
    kind: "number",
    impact: 3,
    askable: true,
    answerCost: 1,
    question: "What year did you start?",
    example: "2003",
  },
  {
    path: "foundation.legalEntityType",
    category: "foundation",
    label: "Legal entity",
    kind: "text",
    impact: 2,
    askable: true,
    answerCost: 1,
    question: "Is the business an LLC, a corporation, or something else?",
  },
  {
    path: "foundation.employeeCount",
    category: "foundation",
    label: "Team size",
    kind: "number",
    impact: 3,
    askable: true,
    answerCost: 1,
    question: "Roughly how many people work at the business?",
    example: "12",
  },
  {
    path: "foundation.revenue",
    category: "foundation",
    label: "Revenue",
    kind: "text",
    impact: 1,
    askable: true,
    answerCost: 2,
    question: "Roughly what does the business bring in a year?",
  },
  {
    path: "foundation.mainAddress",
    category: "foundation",
    label: "Main address",
    kind: "composite",
    impact: 5,
    askable: true,
    answerCost: 1,
    question: "Where are you based?",
    group: "location",
  },
  {
    path: "foundation.otherLocations",
    category: "foundation",
    label: "Other locations",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Do you have any other locations?",
    group: "location",
  },
  {
    path: "foundation.serviceLocations",
    category: "foundation",
    label: "Areas served",
    kind: "chips",
    impact: 5,
    askable: true,
    answerCost: 1,
    question: "Which areas do you serve?",
    example: "Austin, Bee Cave, Lakeway",
    group: "location",
  },
  {
    path: "foundation.altNames",
    category: "foundation",
    label: "Also known as",
    kind: "chips",
    impact: 2,
    askable: true,
    answerCost: 1,
    question: "Does the business go by any other names?",
  },
  {
    path: "foundation.phone",
    category: "foundation",
    label: "Phone",
    kind: "text",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "What number should customers call?",
    group: "contact",
  },
  {
    path: "foundation.email",
    category: "foundation",
    label: "Email",
    kind: "text",
    impact: 3,
    askable: true,
    answerCost: 1,
    question: "What email should customers use?",
    group: "contact",
  },

  /* ----------------------------------------------------------- positioning */
  {
    path: "positioning.pitch",
    category: "positioning",
    label: "Elevator pitch",
    kind: "prose",
    impact: 5,
    askable: false,
    answerCost: 2,
    substitutes: ["foundation.overview"],
  },
  {
    path: "positioning.foundingStory",
    category: "positioning",
    label: "Founding story",
    kind: "prose",
    impact: 4,
    askable: true,
    answerCost: 2,
    question: "What made you start the business?",
  },

  /* ---------------------------------------------------------------- market */
  {
    path: "market.buyers",
    category: "market",
    label: "Who buys from you",
    kind: "chips",
    impact: 5,
    askable: true,
    answerCost: 2,
    question: "Who are your typical customers?",
    example: "Homeowners, ranch owners, builders",
  },
  {
    path: "market.customerNeeds",
    category: "market",
    label: "What customers need",
    kind: "prose",
    impact: 4,
    askable: false,
    answerCost: 2,
    substitutes: ["market.buyers"],
  },
  {
    path: "market.idealPersona",
    category: "market",
    label: "Ideal customer",
    kind: "prose",
    impact: 4,
    askable: true,
    answerCost: 3,
    question: "Describe your ideal customer — who do you most want to work with?",
    substitutes: ["market.buyers"],
  },
  {
    path: "market.industryGroupings",
    category: "market",
    label: "Industry categories",
    kind: "chips",
    impact: 2,
    askable: false,
    answerCost: 1,
  },
  {
    path: "market.industryOutlook",
    category: "market",
    label: "Industry outlook",
    kind: "prose",
    impact: 2,
    // External market data. Asking an SMB owner for their sector's outlook is
    // asking them to do our research.
    askable: false,
    answerCost: 3,
  },
  {
    path: "market.channels",
    category: "market",
    label: "Where you find customers",
    kind: "chips",
    impact: 3,
    askable: true,
    answerCost: 2,
    question: "How do most new customers find you?",
    example: "Google, referrals, Facebook",
  },
  {
    path: "market.funnels",
    category: "market",
    label: "How customers get in touch",
    kind: "chips",
    impact: 3,
    askable: false,
    answerCost: 1,
  },
  {
    path: "market.ctas",
    category: "market",
    label: "Calls to action",
    kind: "chips",
    impact: 3,
    askable: false,
    answerCost: 1,
  },
  {
    path: "market.suppliersPartners",
    category: "market",
    label: "Tools & partners",
    kind: "chips",
    impact: 2,
    askable: false,
    answerCost: 1,
  },

  /* -------------------------------------------------------------- branding */
  {
    path: "branding.writingStyle",
    category: "branding",
    label: "Writing style",
    kind: "composite",
    impact: 4,
    askable: false,
    answerCost: 3,
  },
  {
    path: "branding.artStyle",
    category: "branding",
    label: "Visual style",
    kind: "prose",
    impact: 3,
    askable: false,
    answerCost: 3,
  },
  {
    path: "branding.fonts",
    category: "branding",
    label: "Fonts",
    kind: "chips",
    impact: 2,
    askable: false,
    answerCost: 2,
  },
  {
    path: "branding.colors",
    category: "branding",
    label: "Brand colours",
    kind: "color",
    impact: 3,
    askable: false,
    answerCost: 2,
  },
  {
    path: "branding.logos",
    category: "branding",
    label: "Logo",
    kind: "link",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Can you point us at your logo?",
  },

  /* ------------------------------------------------------- online presence */
  {
    path: "onlinePresence.profiles",
    category: "onlinePresence",
    label: "Social profiles",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Which social accounts do you use?",
    example: "Instagram, LinkedIn",
  },

  /* ---------------------------------------------------------------- people */
  {
    path: "people",
    category: "people",
    label: "Key people",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 2,
    question: "Who are the main people customers deal with?",
  },

  /* ------------------------------------------------------------- offerings */
  {
    path: "offerings",
    category: "offerings",
    label: "Products & services",
    kind: "records",
    impact: 5,
    askable: true,
    answerCost: 2,
    question: "What do you sell? List your main services or products.",
  },

  /* ----------------------------------------------------------------- proof */
  {
    path: "proof.testimonials",
    category: "proof",
    label: "Testimonials",
    kind: "records",
    impact: 5,
    askable: true,
    answerCost: 2,
    question: "Do you have customer reviews or testimonials we can use?",
  },
  {
    path: "proof.aggregateRatings",
    category: "proof",
    label: "Review scores",
    kind: "records",
    impact: 3,
    askable: false,
    answerCost: 1,
  },
  {
    path: "proof.caseStudies",
    category: "proof",
    label: "Case studies",
    kind: "records",
    impact: 3,
    askable: true,
    answerCost: 3,
    question: "Is there a customer project you'd want written up in detail?",
  },
  {
    path: "proof.certifications",
    category: "proof",
    label: "Licences & certifications",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "What licences or certifications does the business hold?",
    group: "credentials",
  },
  {
    path: "proof.memberships",
    category: "proof",
    label: "Memberships",
    kind: "records",
    impact: 3,
    askable: true,
    answerCost: 1,
    question: "Are you a member of any trade or industry associations?",
    group: "credentials",
  },
  {
    path: "proof.awards",
    category: "proof",
    label: "Awards",
    kind: "records",
    impact: 2,
    askable: true,
    answerCost: 1,
    question: "Have you won any awards?",
    group: "credentials",
  },
  {
    path: "proof.pressMentions",
    category: "proof",
    label: "Press coverage",
    kind: "records",
    impact: 2,
    askable: true,
    answerCost: 2,
    question: "Has the business been featured anywhere — news, radio, a trade magazine?",
  },
  {
    path: "proof.trustStats",
    category: "proof",
    label: "Proof points",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Any numbers you're proud of?",
    example: "40+ years, 5,000 wells drilled",
  },
  {
    path: "proof.guarantees",
    category: "proof",
    label: "Guarantees",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 1,
    question: "Do you offer any guarantees, warranties, or insurance cover?",
  },
  {
    path: "proof.clientLogos",
    category: "proof",
    label: "Client logos",
    kind: "records",
    impact: 2,
    askable: false,
    answerCost: 2,
  },

  /* --------------------------------------------------- content intelligence */
  {
    path: "contentIntelligence.themes",
    category: "contentIntelligence",
    label: "Content themes",
    kind: "chips",
    impact: 3,
    askable: false,
    answerCost: 2,
  },
  {
    path: "contentIntelligence.posts",
    category: "contentIntelligence",
    label: "Articles & posts",
    kind: "records",
    impact: 3,
    askable: false,
    answerCost: 2,
  },
  {
    path: "contentIntelligence.taxonomy",
    category: "contentIntelligence",
    label: "Blog categories & tags",
    kind: "composite",
    impact: 1,
    askable: false,
    answerCost: 1,
  },
  {
    path: "contentIntelligence.cadence",
    category: "contentIntelligence",
    label: "Publishing cadence",
    kind: "composite",
    impact: 2,
    askable: false,
    answerCost: 1,
  },
  {
    path: "contentIntelligence.headlinePatterns",
    category: "contentIntelligence",
    label: "Headline patterns",
    kind: "records",
    impact: 2,
    askable: false,
    answerCost: 2,
  },
  {
    path: "contentIntelligence.faqs",
    category: "contentIntelligence",
    label: "Frequently asked questions",
    kind: "records",
    impact: 4,
    askable: true,
    answerCost: 2,
    question: "What do customers ask you most often?",
  },
  {
    path: "contentIntelligence.glossary",
    category: "contentIntelligence",
    label: "Industry terms",
    kind: "records",
    impact: 3,
    askable: true,
    answerCost: 3,
    question:
      "Are there terms in your trade that customers usually need explained?",
  },
  {
    path: "contentIntelligence.seasonalSignals",
    category: "contentIntelligence",
    label: "Seasonal offers",
    kind: "records",
    impact: 2,
    askable: true,
    answerCost: 1,
    question: "Is your work seasonal, or do you run seasonal promotions?",
  },
  {
    path: "contentIntelligence.contentGaps",
    category: "contentIntelligence",
    label: "Content gaps",
    kind: "records",
    impact: 3,
    askable: false,
    answerCost: 3,
  },
] as const;

const BY_PATH = new Map(FIELD_META.map((meta) => [meta.path, meta]));

export function fieldMeta(path: string): FieldMeta | undefined {
  return BY_PATH.get(path);
}

export function fieldsInCategory(category: CategoryId): FieldMeta[] {
  return FIELD_META.filter((meta) => meta.category === category);
}

/** Fields that count toward the overall completeness denominator. */
export function askableFields(): FieldMeta[] {
  return FIELD_META.filter((meta) => meta.askable);
}
