import {
  fieldsInCategory,
  needsReview,
  type Address,
  type AggregateRating,
  type Award,
  type BrandColor,
  type Cadence,
  type CaseStudy,
  type CategoryId,
  type ContentGap,
  type ContentItem,
  type Credential,
  type Faq,
  type FieldMeta,
  type GlossaryTerm,
  type Guarantee,
  type HeadlinePattern,
  type KnowledgeBase,
  type MediaRef,
  type Offering,
  type Person,
  type PressMention,
  type RecordProvenance,
  type SeasonalSignal,
  type SocialProfile,
  type Sourced,
  type Testimonial,
  type Theme,
  type TrustStat,
  type WritingStyle,
} from "@/lib/schema";
import { isFilled } from "@/lib/scraper/analyzers/completeness";
import { getPath } from "@/lib/utils/path";

/**
 * Turning a knowledge base into something a person reads.
 *
 * All of it is pure and lives outside the components, for two reasons: the
 * rendering rules are the part worth unit-testing (a presenter that drops an
 * offering's price is a real bug and an invisible one), and P5's editors need the
 * same labels and formatting as P4's read-only view.
 *
 * One rule runs through the file: **nothing here invents a value.** A presenter
 * that can't find a title says so; it never substitutes a plausible one.
 */

/* --------------------------------------------------------------- field views */

export type FieldView = {
  meta: FieldMeta;
  field: Sourced<unknown>;
  /** Low confidence, a reconciler note, or AI-generated — see `reviewFlag`. */
  attention: boolean;
};

export type CategoryView = {
  category: CategoryId;
  /** Fields with a value, in schema order. */
  filled: FieldView[];
  /**
   * Fields we looked for and didn't find. Shown, not hidden — DATA-QUALITY §1 —
   * and carried as full views because P5 lets the user fill them in place.
   */
  missing: FieldView[];
  attentionCount: number;
};

export function categoryView(
  kb: KnowledgeBase,
  category: CategoryId,
): CategoryView {
  const filled: FieldView[] = [];
  const missing: FieldView[] = [];

  for (const meta of fieldsInCategory(category)) {
    const field = getPath(kb, meta.path) as Sourced<unknown> | undefined;
    if (!field) continue;

    const view: FieldView = { meta, field, attention: needsReview(field) };
    if (isFilled(field)) filled.push(view);
    else missing.push(view);
  }

  return {
    category,
    filled,
    missing,
    attentionCount: filled.filter((view) => view.attention).length,
  };
}

/** How many records a collection field holds, for the collapsed section summary. */
export function fieldCount(field: Sourced<unknown>): number | null {
  return Array.isArray(field.value) ? field.value.length : null;
}

/**
 * The line on a collapsed section.
 *
 * "1 of 1 found" is technically true of a category whose single field holds
 * thirty people, and useless. Where a category *is* one collection, the count
 * that matters is the number of records in it.
 */
export function categorySummary(view: CategoryView): string {
  const total = view.filled.length + view.missing.length;

  if (view.filled.length === 1) {
    const count = fieldCount(view.filled[0].field);
    if (count !== null) {
      return `${count} ${view.filled[0].meta.label.toLowerCase()}`;
    }
  }

  return `${view.filled.length} of ${total} found`;
}

/* -------------------------------------------------------------- review flags */

export type ReviewFlag = { label: string; detail: string };

/**
 * The plain-language version of "this field is in the attention tier".
 *
 * Confidence is never rendered as a number (docs/EDIT-UX.md §5) — `0.73` is not
 * something a non-technical owner can act on, but "we found two different
 * answers" is. AI-generated fields are excluded here because their provenance
 * badge already says `AI draft`/`AI sample` in a louder colour; two badges saying
 * the same thing is noise.
 */
export function reviewFlag(field: Sourced<unknown>): ReviewFlag | null {
  if (!needsReview(field)) return null;
  if (field.method === "ai-live" || field.method === "ai-mock") return null;

  if (field.note) {
    return { label: "Worth a look", detail: field.note };
  }
  return {
    label: "Not fully sure",
    detail: "We pieced this together rather than reading it directly. Worth confirming.",
  };
}

/* ------------------------------------------------------------ source labels */

/**
 * "the Contact page" from `https://example.com/contact-us`.
 *
 * Users recognise their own pages by name; they do not recognise their own URLs,
 * and a raw URL in a provenance popover is the sort of thing docs/EDIT-UX.md §1
 * rules out.
 */
export function pageLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "the home page";

  const last = segments[segments.length - 1]
    .replace(/\.\w+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (last.length === 0) return "the home page";

  return `the ${sentenceCase(last)} page`;
}

/** "Found on the About page and 2 others." — the provenance popover's body. */
export function sourceSummary(sourceUrls: string[]): string | null {
  if (sourceUrls.length === 0) return null;

  const first = pageLabel(sourceUrls[0]);
  if (sourceUrls.length === 1) return `Found on ${first}.`;
  if (sourceUrls.length === 2) return `Found on ${first} and ${pageLabel(sourceUrls[1])}.`;
  return `Found on ${first} and ${sourceUrls.length - 1} other pages.`;
}

/* ------------------------------------------------------------ display kinds */

/**
 * How a field is *shown*, which is not always how it is *edited*.
 *
 * `FieldMeta.kind` names the P5 editor. Three fields want a different read-only
 * treatment: logos and client logos are worth seeing rather than clicking, and
 * themes are stored as records but read as a row of chips.
 */
export type DisplayKind =
  | "text"
  | "prose"
  | "chips"
  | "color"
  | "link"
  | "media"
  | "records"
  | "composite";

const DISPLAY_OVERRIDES: Record<string, DisplayKind> = {
  "branding.logos": "media",
  "proof.clientLogos": "media",
  "contentIntelligence.themes": "chips",
  "foundation.otherLocations": "records",
};

export function displayKind(meta: FieldMeta): DisplayKind {
  const override = DISPLAY_OVERRIDES[meta.path];
  if (override) return override;
  if (meta.kind === "number" || meta.kind === "enum") return "text";
  return meta.kind;
}

/* --------------------------------------------------------------- formatting */

/**
 * Enum values that don't survive mechanical humanisation. Everything else —
 * `service-provider`, `industry-solution` — reads correctly as sentence case, so
 * only the acronyms and brand names are listed.
 */
const ENUM_LABELS: Record<string, string> = {
  b2b: "Businesses (B2B)",
  b2c: "Consumers (B2C)",
  b2b2c: "Businesses and their customers (B2B2C)",
  b2g: "Government (B2G)",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  yelp: "Yelp",
  "google-business": "Google Business Profile",
  "how-to": "How-to",
  faq: "FAQ",
  cta: "CTA",
};

export function enumLabel(value: string): string {
  return ENUM_LABELS[value] ?? sentenceCase(value.replace(/[-_]+/g, " "));
}

/** A scalar as one line of text. Returns `null` when there is nothing to show. */
export function formatScalar(meta: FieldMeta, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return formatNumber(value, meta.path);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return meta.kind === "enum" ? enumLabel(trimmed) : trimmed;
}

function formatNumber(value: number, path: string): string {
  // A year is a number the schema happens to store as one; thousands separators
  // would turn 1,980 into a quantity.
  if (path.endsWith("yearFounded")) return String(value);
  return value.toLocaleString("en-US");
}

/** The strings behind a chip row, whatever the underlying record shape. */
export function chipValues(path: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  if (path === "contentIntelligence.themes") {
    return (value as Theme[]).map((theme) => theme.label);
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function formatAddress(address: Address): string {
  return address.formatted;
}

export function formatRating(value: number, best: number | null): string {
  const ceiling = best ?? 5;
  return `${round(value)} out of ${round(ceiling)}`;
}

/* ----------------------------------------------------------------- records */

export type RecordDetail = { label: string; value: string };

export type DisplayRecord = {
  /** React key: the record's own id where it has one, else path + index. */
  key: string;
  title: string;
  subtitle: string | null;
  /** Short labels shown as badges: category, platform, credential kind. */
  tags: string[];
  details: RecordDetail[];
  /** Longer prose: a bio, a description, a quote, an answer. */
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  provenance: RecordProvenance | null;
};

type Presented = Omit<DisplayRecord, "key" | "provenance">;
type Presenter = (item: unknown, index: number) => Presented;

/** Keeps each presenter typed at its definition site without an `any` cast table. */
function presenter<T>(fn: (item: T, index: number) => Presented): Presenter {
  return (item, index) => fn(item as T, index);
}

function base(overrides: Partial<Presented> & { title: string }): Presented {
  return {
    subtitle: null,
    tags: [],
    details: [],
    body: null,
    url: null,
    imageUrl: null,
    ...overrides,
  };
}

/** Drops details with nothing in them, so a sparse record renders as a short one. */
function details(
  entries: Array<[string, string | number | null | undefined]>,
): RecordDetail[] {
  const out: RecordDetail[] = [];
  for (const [label, value] of entries) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) out.push({ label, value: text });
  }
  return out;
}

const RECORD_PRESENTERS: Record<string, Presenter> = {
  people: presenter<Person>((person) =>
    base({
      title: person.name,
      subtitle: person.title,
      tags: person.role && person.role !== "unknown" ? [enumLabel(person.role)] : [],
      body: person.bio,
      details: details([
        ["Email", person.email],
        ["Phone", person.phone],
        // Gender is always an inference (see entities.ts) — labelled as one so
        // nobody reads it as something the site stated.
        ["Gender (guessed)", person.gender && person.gender !== "unknown" ? enumLabel(person.gender) : null],
      ]),
      url: person.profileUrl ?? person.linkedin,
      imageUrl: person.imageUrl,
    }),
  ),

  offerings: presenter<Offering>((offering) =>
    base({
      title: offering.name,
      tags: offering.category ? [enumLabel(offering.category)] : [],
      body: offering.description,
      details: details([
        ["Price", offering.pricing],
        ["Includes", offering.features.join(" · ")],
      ]),
      url: offering.url,
    }),
  ),

  "onlinePresence.profiles": presenter<SocialProfile>((profile) =>
    base({
      title: enumLabel(profile.platform),
      subtitle: profile.handle,
      url: profile.url,
    }),
  ),

  "foundation.otherLocations": presenter<Address>((address) =>
    base({
      title: address.formatted,
      details: details([
        ["City", address.city],
        ["Region", address.region],
        ["Country", address.country],
      ]),
    }),
  ),

  "proof.testimonials": presenter<Testimonial>((testimonial) =>
    base({
      title: testimonial.authorName ?? "Customer",
      subtitle:
        [testimonial.authorRole, testimonial.authorCompany, testimonial.authorLocation]
          .filter(Boolean)
          .join(", ") || null,
      tags: [
        testimonial.platform ? enumLabel(testimonial.platform) : null,
        testimonial.rating !== null ? formatRating(testimonial.rating, 5) : null,
      ].filter((tag): tag is string => tag !== null),
      body: `“${testimonial.quote}”`,
      details: details([
        ["Date", testimonial.date],
        ["About", testimonial.topics.join(", ")],
      ]),
      url: testimonial.mediaUrl,
    }),
  ),

  "proof.aggregateRatings": presenter<AggregateRating>((rating) =>
    base({
      title: rating.platform,
      subtitle: formatRating(rating.ratingValue, rating.bestRating),
      details: details([
        ["Reviews", rating.reviewCount],
      ]),
    }),
  ),

  "proof.caseStudies": presenter<CaseStudy>((study) =>
    base({
      title: study.title,
      subtitle: study.client,
      body: study.solution ?? study.problem,
      details: details([
        ["Problem", study.problem && study.solution ? study.problem : null],
        ["Results", study.results.join(" · ")],
        ["Numbers", study.metrics.join(" · ")],
      ]),
      url: study.url,
    }),
  ),

  "proof.certifications": credentialPresenter(),
  "proof.memberships": credentialPresenter(),

  "proof.awards": presenter<Award>((award) =>
    base({
      title: award.name,
      subtitle: award.issuer,
      details: details([["Year", award.year]]),
    }),
  ),

  "proof.pressMentions": presenter<PressMention>((mention) =>
    base({
      title: mention.title ?? mention.outlet,
      subtitle: mention.title ? mention.outlet : null,
      tags: [enumLabel(mention.kind)],
      details: details([["Date", mention.date]]),
      url: mention.url,
    }),
  ),

  "proof.trustStats": presenter<TrustStat>((stat) =>
    base({
      title: stat.claim,
      tags: [enumLabel(stat.category)],
      details: details([["As of", stat.asOfDate]]),
    }),
  ),

  "proof.guarantees": presenter<Guarantee>((guarantee) =>
    base({
      title: guarantee.text,
      tags: [enumLabel(guarantee.kind)],
      body: guarantee.terms,
    }),
  ),

  "contentIntelligence.posts": presenter<ContentItem>((post) =>
    base({
      title: post.title,
      subtitle: post.publishedAt,
      tags: post.category ? [post.category] : [],
      body: post.excerpt,
      details: details([
        ["By", post.author],
        ["Words", post.wordCount],
      ]),
      url: post.url,
    }),
  ),

  "contentIntelligence.headlinePatterns": presenter<HeadlinePattern>((pattern) =>
    base({
      title: enumLabel(pattern.pattern),
      subtitle: `${pattern.count} ${pattern.count === 1 ? "post" : "posts"}`,
      details: details([["For example", pattern.examples.slice(0, 3).join(" · ")]]),
    }),
  ),

  "contentIntelligence.faqs": presenter<Faq>((faq) =>
    base({
      title: faq.question,
      tags: faq.topic ? [faq.topic] : [],
      body: faq.answer,
    }),
  ),

  "contentIntelligence.glossary": presenter<GlossaryTerm>((term) =>
    base({ title: term.term, body: term.definition }),
  ),

  "contentIntelligence.seasonalSignals": presenter<SeasonalSignal>((signal) =>
    base({ title: signal.label, subtitle: signal.period, body: signal.text }),
  ),

  "contentIntelligence.contentGaps": presenter<ContentGap>((gap) =>
    base({ title: gap.topic, body: gap.reason }),
  ),
};

function credentialPresenter(): Presenter {
  return presenter<Credential>((credential) =>
    base({
      title: credential.name,
      subtitle: credential.issuer,
      tags: [enumLabel(credential.kind)],
      details: details([
        ["Number", credential.identifier],
        ["Valid until", credential.validUntil],
      ]),
      url: credential.verifyUrl,
    }),
  );
}

/**
 * Last resort for a record shape without a presenter. It reads the fields any
 * record is likely to have rather than dumping JSON at the user, and it exists
 * so that adding a collection to the schema degrades to "plain" instead of
 * "blank".
 */
const genericPresenter: Presenter = (item) => {
  const object = (item ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof object[key] === "string" ? (object[key] as string) : null;

  return base({
    title: pick("name") ?? pick("title") ?? pick("label") ?? pick("text") ?? "Untitled",
    body: pick("description") ?? pick("summary"),
    url: pick("url"),
  });
};

export function presentRecords(path: string, value: unknown): DisplayRecord[] {
  if (!Array.isArray(value)) return [];
  const present = RECORD_PRESENTERS[path] ?? genericPresenter;

  return value.map((item, index) => {
    const provenance = recordProvenance(item);
    return {
      key: provenance?.id ?? `${path}-${index}`,
      provenance,
      ...present(item, index),
    };
  });
}

/** Records carry their own provenance; plain structures (addresses) don't. */
function recordProvenance(item: unknown): RecordProvenance | null {
  if (typeof item !== "object" || item === null) return null;
  const candidate = item as Partial<RecordProvenance>;
  if (typeof candidate.id !== "string" || typeof candidate.method !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    method: candidate.method,
    confidence: candidate.confidence ?? 0,
    sourceUrls: candidate.sourceUrls ?? [],
    ...(candidate.note ? { note: candidate.note } : {}),
  };
}

/** Whether a record should sit in the attention tier — the record-level `needsReview`. */
export function recordNeedsReview(provenance: RecordProvenance | null): boolean {
  if (!provenance) return false;
  return needsReview({
    value: true,
    method: provenance.method,
    confidence: provenance.confidence,
    sourceUrls: provenance.sourceUrls,
    ...(provenance.note ? { note: provenance.note } : {}),
  });
}

/* -------------------------------------------------------------- composites */

/** A structured scalar flattened into label/value rows. */
export function presentComposite(path: string, value: unknown): RecordDetail[] {
  if (value === null || value === undefined) return [];

  switch (path) {
    case "foundation.mainAddress": {
      const address = value as Address;
      return details([
        ["Address", address.formatted],
        ["City", address.city],
        ["Region", address.region],
        ["Postal code", address.postalCode],
        ["Country", address.country],
      ]);
    }

    case "branding.writingStyle": {
      const style = value as WritingStyle;
      return details([
        ["How it reads", style.description],
        ["Tone", style.tone.map(enumLabel).join(", ")],
        ["Formality", enumLabel(style.formality)],
        ["Speaks to the reader as", readerAddressLabel(style.readerAddress)],
        ["Words they use", style.preferredTerms.join(", ")],
        ["Words they avoid", style.avoidTerms.join(", ")],
        ["Calls to action", style.ctaStyle],
      ]);
    }

    case "contentIntelligence.taxonomy": {
      const taxonomy = value as { categories: string[]; tags: string[] };
      return details([
        ["Categories", taxonomy.categories.join(", ")],
        ["Tags", taxonomy.tags.join(", ")],
      ]);
    }

    case "contentIntelligence.cadence": {
      const cadence = value as Cadence;
      return details([
        [
          "How often they publish",
          cadence.postsPerMonth === null
            ? null
            : `${round(cadence.postsPerMonth)} posts a month`,
        ],
        ["First post", cadence.firstPublished],
        ["Latest post", cadence.lastPublished],
        [
          "Last published",
          cadence.daysSinceLast === null
            ? null
            : `${cadence.daysSinceLast} days ago${cadence.isStale ? " — the blog has gone quiet" : ""}`,
        ],
      ]);
    }

    default:
      return typeof value === "string" ? [{ label: "Value", value }] : [];
  }
}

function readerAddressLabel(value: WritingStyle["readerAddress"]): string {
  switch (value) {
    case "second-person":
      return "“you”";
    case "third-person":
      return "“our customers”";
    default:
      return "a mix of “you” and “our customers”";
  }
}

/* ------------------------------------------------------------------ colors */

export type DisplayColor = { hex: string; role: string; share: number };

/**
 * Colours with their share of the palette, so the bar widths mean something.
 * Roles are shown because "which one is the background" is the question a
 * content generator actually needs answered (ROADMAP §2.3).
 */
export function presentColors(value: unknown): DisplayColor[] {
  if (!Array.isArray(value)) return [];
  const colors = value as BrandColor[];
  const total = colors.reduce((sum, color) => sum + color.frequency, 0);

  return colors.map((color) => ({
    hex: color.hex,
    role: color.role === "unknown" ? "Other" : sentenceCase(color.role),
    share: total === 0 ? 0 : color.frequency / total,
  }));
}

/* ------------------------------------------------------------------ media */

export function presentMedia(value: unknown): MediaRef[] {
  return Array.isArray(value) ? (value as MediaRef[]) : [];
}

/* ------------------------------------------------------------------ shared */

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/* ------------------------------------------------------------- scrape stats */

/** The header line: "20 pages read in 24s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
