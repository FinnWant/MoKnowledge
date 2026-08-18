import {
  businessModelSchema,
  companyRoleSchema,
  credentialKindSchema,
  newId,
  offeringCategorySchema,
  personRoleSchema,
  socialPlatformSchema,
  toneSchema,
  trustStatCategorySchema,
  type RecordProvenance,
} from "@/lib/schema";

/**
 * What a record is made of, for the editors.
 *
 * The zod schema knows the *types*; this knows which sub-fields a person should
 * be asked to correct, in what order, with what label and which control. Keeping
 * it as data is what lets one `RecordListField` edit people, offerings,
 * testimonials, FAQs and eight more without a component per collection
 * (docs/EDIT-UX.md §4).
 */

export type RecordFieldKind = "text" | "prose" | "enum" | "number" | "chips" | "link";

export type RecordFieldSpec = {
  key: string;
  label: string;
  kind: RecordFieldKind;
  /** Required for `enum`. */
  options?: readonly string[];
  placeholder?: string;
  /** The field that identifies the record. Empty means the record is empty. */
  identity?: boolean;
};

const PERSON_ROLES = personRoleSchema.options;
const OFFERING_CATEGORIES = offeringCategorySchema.options;
const CREDENTIAL_KINDS = credentialKindSchema.options;
const SOCIAL_PLATFORMS = socialPlatformSchema.options;
const TRUST_STAT_CATEGORIES = trustStatCategorySchema.options;

export const RECORD_FIELDS: Record<string, readonly RecordFieldSpec[]> = {
  people: [
    { key: "name", label: "Name", kind: "text", identity: true, placeholder: "Jane Doe" },
    { key: "title", label: "Job title", kind: "text", placeholder: "Service Manager" },
    { key: "role", label: "Role", kind: "enum", options: PERSON_ROLES },
    { key: "bio", label: "About", kind: "prose" },
    { key: "email", label: "Email", kind: "text" },
    { key: "phone", label: "Phone", kind: "text" },
    { key: "linkedin", label: "LinkedIn", kind: "link" },
  ],

  offerings: [
    { key: "name", label: "Name", kind: "text", identity: true, placeholder: "Well inspection" },
    { key: "category", label: "Type", kind: "enum", options: OFFERING_CATEGORIES },
    { key: "description", label: "Description", kind: "prose" },
    { key: "pricing", label: "Price", kind: "text", placeholder: "starting at $250" },
    { key: "features", label: "What's included", kind: "chips" },
    { key: "url", label: "Page", kind: "link" },
  ],

  "onlinePresence.profiles": [
    { key: "platform", label: "Platform", kind: "enum", options: SOCIAL_PLATFORMS, identity: true },
    { key: "url", label: "Link", kind: "link" },
    { key: "handle", label: "Username", kind: "text" },
  ],

  "foundation.otherLocations": [
    { key: "formatted", label: "Address", kind: "text", identity: true },
    { key: "city", label: "City", kind: "text" },
    { key: "region", label: "State / region", kind: "text" },
    { key: "postalCode", label: "Postal code", kind: "text" },
    { key: "country", label: "Country", kind: "text" },
  ],

  "proof.testimonials": [
    { key: "quote", label: "What they said", kind: "prose", identity: true },
    { key: "authorName", label: "Who said it", kind: "text" },
    { key: "authorRole", label: "Their role", kind: "text" },
    { key: "authorCompany", label: "Their company", kind: "text" },
    { key: "authorLocation", label: "Where they are", kind: "text" },
    { key: "rating", label: "Rating out of 5", kind: "number" },
    { key: "platform", label: "Where it was posted", kind: "text" },
    { key: "date", label: "Date", kind: "text" },
    { key: "topics", label: "What it's about", kind: "chips" },
  ],

  "proof.aggregateRatings": [
    { key: "platform", label: "Platform", kind: "text", identity: true },
    { key: "ratingValue", label: "Rating", kind: "number" },
    { key: "bestRating", label: "Out of", kind: "number" },
    { key: "reviewCount", label: "Number of reviews", kind: "number" },
  ],

  "proof.caseStudies": [
    { key: "title", label: "Title", kind: "text", identity: true },
    { key: "client", label: "Client", kind: "text" },
    { key: "problem", label: "The problem", kind: "prose" },
    { key: "solution", label: "What you did", kind: "prose" },
    { key: "results", label: "Results", kind: "chips" },
    { key: "metrics", label: "Numbers", kind: "chips" },
    { key: "url", label: "Page", kind: "link" },
  ],

  "proof.certifications": credentialFields(),
  "proof.memberships": credentialFields(),

  "proof.awards": [
    { key: "name", label: "Award", kind: "text", identity: true },
    { key: "issuer", label: "Given by", kind: "text" },
    { key: "year", label: "Year", kind: "number" },
  ],

  "proof.pressMentions": [
    { key: "outlet", label: "Publication", kind: "text", identity: true },
    { key: "title", label: "Headline", kind: "text" },
    { key: "url", label: "Link", kind: "link" },
    { key: "date", label: "Date", kind: "text" },
    { key: "kind", label: "Type", kind: "enum", options: ["feature", "quote", "listing"] },
  ],

  "proof.trustStats": [
    { key: "claim", label: "The claim", kind: "text", identity: true, placeholder: "over 40 years" },
    { key: "value", label: "Number", kind: "number" },
    { key: "unit", label: "Unit", kind: "text" },
    { key: "category", label: "Type", kind: "enum", options: TRUST_STAT_CATEGORIES },
    { key: "asOfDate", label: "As of", kind: "text" },
  ],

  "proof.guarantees": [
    { key: "text", label: "The promise", kind: "prose", identity: true },
    {
      key: "kind",
      label: "Type",
      kind: "enum",
      options: ["warranty", "satisfaction", "licensing", "insurance", "bonding"],
    },
    { key: "terms", label: "Conditions", kind: "prose" },
  ],

  "proof.clientLogos": [
    { key: "url", label: "Image link", kind: "link", identity: true },
    { key: "alt", label: "Client name", kind: "text" },
  ],

  "branding.logos": [
    { key: "url", label: "Image link", kind: "link", identity: true },
    { key: "alt", label: "Description", kind: "text" },
  ],

  "contentIntelligence.posts": [
    { key: "title", label: "Title", kind: "text", identity: true },
    { key: "url", label: "Link", kind: "link" },
    { key: "publishedAt", label: "Published", kind: "text" },
    { key: "author", label: "Written by", kind: "text" },
    { key: "category", label: "Category", kind: "text" },
    { key: "excerpt", label: "Summary", kind: "prose" },
  ],

  "contentIntelligence.faqs": [
    { key: "question", label: "Question", kind: "text", identity: true },
    { key: "answer", label: "Answer", kind: "prose" },
    { key: "topic", label: "Topic", kind: "text" },
  ],

  "contentIntelligence.glossary": [
    { key: "term", label: "Term", kind: "text", identity: true },
    { key: "definition", label: "What it means", kind: "prose" },
  ],

  "contentIntelligence.seasonalSignals": [
    { key: "label", label: "Offer", kind: "text", identity: true },
    { key: "period", label: "When", kind: "text" },
    { key: "text", label: "Details", kind: "prose" },
  ],

  "contentIntelligence.contentGaps": [
    { key: "topic", label: "Topic", kind: "text", identity: true },
    { key: "reason", label: "Why it matters", kind: "prose" },
  ],
};

function credentialFields(): readonly RecordFieldSpec[] {
  return [
    { key: "name", label: "Name", kind: "text", identity: true },
    { key: "issuer", label: "Issued by", kind: "text" },
    { key: "identifier", label: "Number", kind: "text" },
    { key: "kind", label: "Type", kind: "enum", options: CREDENTIAL_KINDS },
    { key: "validUntil", label: "Valid until", kind: "text" },
    { key: "verifyUrl", label: "Check it here", kind: "link" },
  ];
}

/**
 * What one of these is called, for the `Add` button.
 *
 * Written out rather than derived from the plural: mechanical de-pluralisation
 * produced "Add a products & service" and "Add a award", and a label a customer
 * reads is not the place to be clever.
 */
const RECORD_NOUNS: Record<string, string> = {
  people: "a person",
  offerings: "a product or service",
  "onlinePresence.profiles": "a social profile",
  "foundation.otherLocations": "another location",
  "proof.testimonials": "a testimonial",
  "proof.aggregateRatings": "a review score",
  "proof.caseStudies": "a case study",
  "proof.certifications": "a certification",
  "proof.memberships": "a membership",
  "proof.awards": "an award",
  "proof.pressMentions": "a press mention",
  "proof.trustStats": "a proof point",
  "proof.guarantees": "a guarantee",
  "proof.clientLogos": "a client logo",
  "branding.logos": "a logo",
  "contentIntelligence.posts": "an article",
  "contentIntelligence.faqs": "a question",
  "contentIntelligence.glossary": "a term",
  "contentIntelligence.seasonalSignals": "a seasonal offer",
  "contentIntelligence.contentGaps": "a content gap",
};

/** "Add a person", "Add another location". */
export function addLabel(path: string): string {
  return `Add ${RECORD_NOUNS[path] ?? "an item"}`;
}

/**
 * Collections a person can add to. The rest are computed *about* the site —
 * themes, headline patterns, publishing cadence — and inviting someone to
 * hand-write a derived statistic would be inviting them to corrupt it.
 */
export function isEditableCollection(path: string): boolean {
  return path in RECORD_FIELDS;
}

export function recordFields(path: string): readonly RecordFieldSpec[] {
  return RECORD_FIELDS[path] ?? [];
}

/** The sub-field that names the record, used for the collapsed row and empty checks. */
export function identityField(path: string): RecordFieldSpec | undefined {
  const fields = recordFields(path);
  return fields.find((field) => field.identity) ?? fields[0];
}

/**
 * A new, empty record of the right shape.
 *
 * Provenance says `user-edited` from the moment it exists: everything in it will
 * have been typed by a person, and the badge should say so before they start.
 */
export function blankRecord(path: string): Record<string, unknown> & RecordProvenance {
  const record: Record<string, unknown> = {
    id: newId(),
    method: "user-edited",
    confidence: 1,
    sourceUrls: [],
  };

  for (const field of recordFields(path)) {
    record[field.key] = field.kind === "chips" ? [] : field.kind === "text" || field.kind === "prose" || field.kind === "link" ? "" : null;
  }

  // Sub-fields the schema requires but the editor doesn't show, so a hand-added
  // record still validates on save.
  const extras: Record<string, Record<string, unknown>> = {
    people: { gender: null, imageUrl: null, profileUrl: null },
    offerings: { sourceCandidateIndexes: [] },
    "proof.testimonials": { mediaUrl: null, mentionsPeople: [], mentionsOfferings: [] },
    "proof.clientLogos": { kind: "client-logo", width: null, height: null },
    "branding.logos": { kind: "logo", width: null, height: null },
    "contentIntelligence.posts": { wordCount: null, headings: [] },
    "contentIntelligence.contentGaps": { relatedOffering: null },
    "foundation.otherLocations": { street: null },
  };

  return { ...record, ...(extras[path] ?? {}) } as Record<string, unknown> & RecordProvenance;
}

/** True when nothing has been typed into the record that identifies it. */
export function isBlankRecord(path: string, record: Record<string, unknown>): boolean {
  const identity = identityField(path);
  if (!identity) return false;
  const value = record[identity.key];
  return typeof value === "string" ? value.trim().length === 0 : value === null;
}

/* ------------------------------------------------------------ field enums */

/** Options for a scalar `enum` field, straight off the zod schema. */
export const FIELD_ENUM_OPTIONS: Record<string, readonly string[]> = {
  "foundation.businessModel": businessModelSchema.options,
  "foundation.companyRole": companyRoleSchema.options,
  "branding.writingStyle.tone": toneSchema.options,
};
