import type { Offering } from "@/lib/schema";
import { normalizeName } from "@/lib/scraper/extractors/offerings";
import type { EnrichmentInput } from "./messages";
import type {
  CompanyProfileResponse,
  OfferingNormalizationResponse,
  ProofExtractionResponse,
  WritingStyleResponse,
} from "./schemas";

/**
 * The no-API-key path.
 *
 * The assignment permits mock AI output "so long as it is clearly labelled", and
 * `prompts/README.md` fixes the contract: with no key the same fields get filled
 * from the same templates and the UI badges them `AI sample`. This module is that
 * generator.
 *
 * The rule it follows is the one the prompts themselves state: **assemble, never
 * invent**. Every sentence below is built out of values the extractors actually
 * found, and any field with no factual basis comes back `null` — the same answer
 * a well-behaved live call would give. A mock that wrote a plausible founding
 * story would be the exact failure the whole grounding design exists to prevent,
 * and it would be indistinguishable from a real one in the saved JSON.
 *
 * Deterministic by construction: same input, same output, so fixtures are stable
 * and `npm run validate` measures the extractors rather than a random seed.
 */

/** Mock output is a placeholder, and its confidence says so. */
export const MOCK_CONFIDENCE = 0.25;

export const MOCK_NOTE =
  "Sample text assembled from scraped facts without a model call. Set ANTHROPIC_API_KEY for live enrichment.";

/* ----------------------------------------------------- 01 company profile */

export function mockCompanyProfile(input: EnrichmentInput): CompanyProfileResponse {
  const name = input.companyName ?? "This business";
  const urls = input.pages.slice(0, 3).map((page) => page.url);

  const offerings = topOfferingNames(input.offeringCandidates, 4);
  const locations = factValue(input, "Areas served") ?? factValue(input, "Main address");
  const industry = input.industry;

  const overviewParts: string[] = [];
  if (industry) {
    overviewParts.push(`${name} works in ${lowerFirst(industry)}.`);
  } else {
    overviewParts.push(`${name} publishes a marketing website but does not state its industry in the pages we read.`);
  }
  if (offerings.length > 0) {
    overviewParts.push(`The site lists ${joinList(offerings)}.`);
  }
  if (locations) overviewParts.push(`It gives its location as ${locations}.`);
  overviewParts.push(
    "This overview is a placeholder assembled from the scraped fields above rather than written by a model.",
  );

  const field = <T,>(value: T | null) => ({
    value,
    confidence: value === null ? 0 : MOCK_CONFIDENCE,
    sourceUrls: value === null ? [] : urls,
  });

  const pitch =
    offerings.length > 0
      ? `We offer ${joinList(offerings)}${locations ? ` in ${locations}` : ""}. This placeholder pitch repeats what the website says; a live model call rewrites it in the company's own voice.`
      : null;

  const customerNeeds = describeNeeds(input, offerings);

  return {
    overview: field(overviewParts.join(" ")),
    // Already extracted from schema.org markup where the site publishes it, and
    // unguessable from anything else without reading the copy.
    industry: { value: null, confidence: 0, sourceUrls: [] },
    // Classifying who a company sells to is a judgment about evidence, and the
    // mock has no way to make it. Guessing "b2c" because most SMBs are would be
    // inventing the most consequential field in the category.
    businessModel: { value: null, confidence: 0, sourceUrls: [] },
    pitch: field(pitch),
    // Never mocked. There is no founding story in the extracted facts, and
    // writing one is fabrication about a real business's history.
    foundingStory: { value: null, confidence: 0, sourceUrls: [] },
    customerNeeds: field(customerNeeds),
    idealPersona: { value: null, confidence: 0, sourceUrls: [] },
    companyRole: { value: null, confidence: 0, sourceUrls: [] },
    // Empty, not absent: the mock looked at the same evidence and has no way to
    // read a service area out of prose. Inventing towns a business does not
    // cover is the single most damaging thing this generator could do.
    serviceLocations: { value: [], confidence: 0, sourceUrls: [] },
    buyers: { value: [], confidence: 0, sourceUrls: [] },
  };
}

function describeNeeds(input: EnrichmentInput, offerings: string[]): string | null {
  const buyers = factValue(input, "Who buys from you");
  if (!buyers && offerings.length === 0) return null;

  const parts: string[] = [];
  if (buyers) parts.push(`The site names its customers as ${buyers}.`);
  if (offerings.length > 0) {
    parts.push(`They come for ${joinList(offerings)}.`);
  }
  parts.push("Placeholder text — a live model call replaces this with a written description.");
  return parts.join(" ");
}

/* ------------------------------------------------ 02 offering normalization */

/**
 * Keyword categorisation, deliberately shallow.
 *
 * The live prompt reads each candidate's description to categorise it; the mock
 * matches the name against the controlled vocabulary and falls back to `service`
 * — the modal category across all eight reference profiles — rather than to
 * `other`, which would make every mocked catalogue look broken.
 */
const CATEGORY_HINTS: Array<[OfferingNormalizationResponse["offerings"][number]["category"], RegExp]> = [
  ["consultation", /\b(consult|consultation|assessment|evaluation|audit|advice|advisory|planning session)\b/i],
  ["financing", /\b(financing|finance|loan|lease|payment plan|mortgage)\b/i],
  ["subscription", /\b(subscription|membership|monthly plan|maintenance plan|retainer)\b/i],
  ["package", /\b(package|bundle|plan|tier)\b/i],
  ["industry-solution", /\b(for (?:contractors|dealers|clinics|schools|restaurants)|industry|vertical)\b/i],
  ["product", /\b(equipment|parts|supplies|hardware|software|kit|unit|system)\b/i],
];

export function mockOfferings(input: EnrichmentInput): OfferingNormalizationResponse {
  const merged = new Map<
    string,
    {
      name: string;
      description: string | null;
      features: string[];
      pricing: string | null;
      indexes: number[];
    }
  >();

  input.offeringCandidates.forEach((candidate, index) => {
    const key = normalizeName(candidate.name) || candidate.name.toLowerCase();
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        name: candidate.name,
        description: candidate.description,
        features: [...candidate.features],
        pricing: candidate.pricing,
        indexes: [index],
      });
      return;
    }

    existing.indexes.push(index);
    // Union the evidence: the merge is the whole point of prompt 02, and it is
    // the part a keyword pass can do honestly.
    existing.description ??= candidate.description;
    existing.pricing ??= candidate.pricing;
    for (const feature of candidate.features) {
      if (!existing.features.includes(feature)) existing.features.push(feature);
    }
    // Prefer the shorter name: "Well Drilling" over "Water Well Drilling Services
    // in Central Texas", which is a page title rather than an offering name.
    if (candidate.name.length < existing.name.length) existing.name = candidate.name;
  });

  return {
    offerings: [...merged.values()].map((offering) => ({
      name: offering.name,
      category: categorize(offering.name),
      description: offering.description ?? "",
      features: offering.features.slice(0, 8),
      pricing: offering.pricing,
      sourceCandidateIndexes: offering.indexes,
      confidence: MOCK_CONFIDENCE,
    })),
  };
}

function categorize(
  name: string,
): OfferingNormalizationResponse["offerings"][number]["category"] {
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(name)) return category;
  }
  return "service";
}

/* ------------------------------------------------------- 03 writing style */

/**
 * The one mock that is nearly as good as the live call.
 *
 * Everything prompt 03 asks for is a reading of numbers we computed ourselves,
 * so the thresholds below reproduce most of the judgment. What the model adds is
 * the prose and the vocabulary selection, and the mock's `description` is
 * plainly mechanical by comparison.
 */
export function mockWritingStyle(input: EnrichmentInput): WritingStyleResponse {
  const metrics = input.metrics;

  const tone: WritingStyleResponse["tone"] = [];
  if (metrics.readingGrade >= 12) tone.push("technical");
  if (metrics.readingGrade < 9) tone.push("conversational");
  if (metrics.secondPersonRatio > 0.35) tone.push("direct");
  if (metrics.firstPersonPluralRatio > 0.35) tone.push("warm");
  if (metrics.exclamationRatio > 0.05) tone.push("urgent");
  if (tone.length === 0) tone.push("professional");

  const formality: WritingStyleResponse["formality"] =
    metrics.readingGrade >= 13 ? "formal" : metrics.readingGrade < 8 ? "casual" : "neutral";

  const readerAddress: WritingStyleResponse["readerAddress"] =
    metrics.secondPersonRatio > metrics.firstPersonPluralRatio * 1.5
      ? "second-person"
      : metrics.firstPersonPluralRatio > metrics.secondPersonRatio * 1.5
        ? "third-person"
        : "mixed";

  const description = metrics.wordCount === 0
    ? "Not enough body copy was scraped to describe how this company writes."
    : [
        `Sentences average ${metrics.averageSentenceLength} words (σ ${metrics.sentenceLengthStdDev}) at a Flesch-Kincaid grade of ${metrics.readingGrade}.`,
        `${percent(metrics.firstPersonPluralRatio)} of sentences use "we" or "our" and ${percent(metrics.secondPersonRatio)} address the reader as "you".`,
        `${percent(metrics.imperativeRatio)} open with an instruction.`,
        "This description reports the measurements; a live model call turns them into a usable voice guide.",
      ].join(" ");

  return {
    description,
    tone,
    formality,
    readerAddress,
    // Real vocabulary from the corpus, not synonyms — the one thing prompt 03
    // insists on, and the measured terms satisfy it directly.
    preferredTerms: metrics.distinctiveTerms.slice(0, 8).map((entry) => entry.term),
    // No evidence of deliberate avoidance is computable, and the prompt says an
    // empty array beats a guess.
    avoidTerms: [],
    ctaStyle: input.ctas.length > 0
      ? `Calls to action found verbatim: ${input.ctas.slice(0, 5).map((cta) => `"${cta}"`).join(", ")}.`
      : "No calls to action were found on the pages we read.",
    confidence: metrics.wordCount > 300 ? MOCK_CONFIDENCE : 0.1,
  };
}

/* ----------------------------------------------------- 04 proof extraction */

/**
 * Returns nothing, on purpose.
 *
 * Prompt 04 exists because a testimonial is a named person's words. Its entire
 * design — verbatim quoting, automatic substring verification in
 * `lib/ai/verify.ts` — is built to make fabrication impossible. A mock that
 * emitted sample testimonials would put invented quotes, attributed to invented
 * customers, into a knowledge base an SMB publishes from, which is worse than
 * the empty result the DOM extractors already fall back to.
 *
 * The scraped testimonials, credentials, and trust stats from
 * `lib/scraper/extractors/proof.ts` are unaffected; this call simply adds
 * nothing to them.
 */
export function mockProof(): ProofExtractionResponse {
  return { testimonials: [], credentials: [], trustStats: [] };
}

/* --------------------------------------------------------------- helpers */

function topOfferingNames(candidates: Offering[], limit: number): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeName(candidate.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(candidate.name);
    if (names.length >= limit) break;
  }
  return names;
}

function factValue(input: EnrichmentInput, label: string): string | null {
  return input.extractedFacts.find((fact) => fact.label === label)?.value ?? null;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function lowerFirst(value: string): string {
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
