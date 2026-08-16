import {
  FIELD_META,
  newId,
  type Award,
  type Credential,
  type ExtractionMethod,
  type KnowledgeBase,
  type Offering,
  type Sourced,
  type Testimonial,
  type TrustStat,
} from "@/lib/schema";
import { getPath, setPath } from "@/lib/utils/path";
import { isFilled } from "@/lib/scraper/analyzers/completeness";
import { quoteKey } from "@/lib/scraper/extractors/proof";
import { hasApiKey, runPrompt } from "./client";
import {
  renderCompanyProfileMessage,
  renderOfferingMessage,
  renderProofMessage,
  renderWritingStyleMessage,
  verificationCorpus,
  type EnrichmentInput,
} from "./messages";
import {
  mockCompanyProfile,
  mockOfferings,
  mockProof,
  mockWritingStyle,
  MOCK_CONFIDENCE,
  MOCK_NOTE,
} from "./mock-enrich";
import {
  companyProfileResponseSchema,
  offeringNormalizationResponseSchema,
  proofExtractionResponseSchema,
  writingStyleResponseSchema,
  COMPANY_PROFILE_JSON_SCHEMA,
  OFFERING_NORMALIZATION_JSON_SCHEMA,
  PROOF_EXTRACTION_JSON_SCHEMA,
  WRITING_STYLE_JSON_SCHEMA,
  type CompanyProfileResponse,
  type OfferingNormalizationResponse,
  type ProofExtractionResponse,
  type WritingStyleResponse,
} from "./schemas";
import { keepVerbatimQuotes } from "./verify";
import type { PromptId } from "./prompts";

/**
 * Enrichment: the four prompts, run live where possible and mocked otherwise,
 * with their output checked before it touches the knowledge base.
 *
 * Three rules hold whichever path a run takes:
 *
 * 1. **Generated values never overwrite scraped ones.** A model's guess at the
 *    phone number does not get to replace the one in the JSON-LD, so every write
 *    below is gated on the field being genuinely empty.
 * 2. **Every claim is checked against the evidence.** Quotes must appear in the
 *    corpus verbatim, offerings must trace to a candidate index, prices must
 *    match a candidate's stated price, and `sourceUrls` must be pages we
 *    actually fetched. Anything that fails is dropped, not flagged.
 * 3. **The provenance says which path ran.** `ai-live` and `ai-mock` are distinct
 *    `ExtractionMethod`s and the review UI badges them differently, so a mocked
 *    field is never mistaken for a generated one.
 */

export type EnrichmentSource = "live" | "mock";

export type PromptReport = {
  promptId: PromptId;
  source: EnrichmentSource;
  /** Why the live call was not used. Absent when it was. */
  reason?: string;
  /** Field paths this prompt filled, or record counts for collections. */
  filled: string[];
};

export type EnrichmentReport = {
  apiKeyPresent: boolean;
  prompts: PromptReport[];
  /** Quotes the model returned that were not found in the source text. */
  droppedQuotes: number;
  /** Offerings dropped for not tracing back to an extracted candidate. */
  droppedOfferings: number;
};

export type EnrichmentResult = {
  knowledgeBase: KnowledgeBase;
  report: EnrichmentReport;
};

export async function enrich(
  knowledgeBase: KnowledgeBase,
  input: EnrichmentInput,
): Promise<EnrichmentResult> {
  let kb = knowledgeBase;
  const prompts: PromptReport[] = [];
  const knownUrls = new Set(input.pages.map((page) => page.url));

  /* ------------------------------------------------- 01 company profile */

  const profile = await run(
    "01-company-profile",
    () =>
      runPrompt<CompanyProfileResponse>({
        promptId: "01-company-profile",
        jsonSchema: COMPANY_PROFILE_JSON_SCHEMA,
        responseSchema: companyProfileResponseSchema,
        userMessage: renderCompanyProfileMessage(input),
      }),
    () => mockCompanyProfile(input),
  );

  const profileFilled: string[] = [];
  for (const [path, field] of profileFields(profile.value)) {
    const applied = applyGenerated(kb, path, field, profile.source, knownUrls);
    if (applied) {
      kb = applied;
      profileFilled.push(path);
    }
  }
  for (const [path, field] of profileListFields(profile.value)) {
    const applied = applyGeneratedList(kb, path, field, profile.source, knownUrls);
    if (applied) {
      kb = applied;
      profileFilled.push(path);
    }
  }
  prompts.push(report(profile, "01-company-profile", profileFilled));

  /* ------------------------------------------ 02 offering normalization */

  let droppedOfferings = 0;
  if (input.offeringCandidates.length > 0) {
    const offerings = await run(
      "02-offering-normalization",
      () =>
        runPrompt<OfferingNormalizationResponse>({
          promptId: "02-offering-normalization",
          jsonSchema: OFFERING_NORMALIZATION_JSON_SCHEMA,
          responseSchema: offeringNormalizationResponseSchema,
          userMessage: renderOfferingMessage(input),
        }),
      () => mockOfferings(input),
    );

    const consolidated = consolidateOfferings(
      offerings.value,
      input.offeringCandidates,
      offerings.source,
    );
    droppedOfferings = offerings.value.offerings.length - consolidated.length;

    if (consolidated.length > 0) {
      const existing = getPath(kb, "offerings") as Sourced<Offering[]>;
      kb = setPath(kb, "offerings", {
        value: consolidated,
        method: methodFor(offerings.source),
        confidence: average(consolidated.map((offering) => offering.confidence)),
        sourceUrls: existing.sourceUrls,
        ...(offerings.source === "mock" ? { note: MOCK_NOTE } : {}),
      } satisfies Sourced<Offering[]>);
    }

    prompts.push(
      report(offerings, "02-offering-normalization", [
        `offerings: ${input.offeringCandidates.length} candidates → ${consolidated.length}`,
      ]),
    );
  }

  /* -------------------------------------------------- 03 writing style */

  if (input.metrics.wordCount > 0) {
    const style = await run(
      "03-writing-style",
      () =>
        runPrompt<WritingStyleResponse>({
          promptId: "03-writing-style",
          jsonSchema: WRITING_STYLE_JSON_SCHEMA,
          responseSchema: writingStyleResponseSchema,
          userMessage: renderWritingStyleMessage(input),
        }),
      () => mockWritingStyle(input),
    );

    const { confidence, ...writingStyle } = style.value;
    kb = setPath(kb, "branding.writingStyle", {
      value: writingStyle,
      method: methodFor(style.source),
      confidence,
      sourceUrls: [...knownUrls].slice(0, 5),
      ...(style.source === "mock" ? { note: MOCK_NOTE } : {}),
    } satisfies Sourced<typeof writingStyle>);

    prompts.push(report(style, "03-writing-style", ["branding.writingStyle"]));
  }

  /* ------------------------------------------------ 04 proof extraction */

  const proof = await run(
    "04-proof-extraction",
    () =>
      runPrompt<ProofExtractionResponse>({
        promptId: "04-proof-extraction",
        jsonSchema: PROOF_EXTRACTION_JSON_SCHEMA,
        responseSchema: proofExtractionResponseSchema,
        userMessage: renderProofMessage(input),
      }),
    () => mockProof(),
  );

  const applied = applyProof(kb, proof.value, proof.source, input);
  kb = applied.knowledgeBase;
  prompts.push(report(proof, "04-proof-extraction", applied.filled));

  return {
    knowledgeBase: kb,
    report: {
      apiKeyPresent: hasApiKey(),
      prompts,
      droppedQuotes: applied.droppedQuotes,
      droppedOfferings,
    },
  };
}

/* ------------------------------------------------------- live-or-mock plumbing */

type Ran<T> = { value: T; source: EnrichmentSource; reason?: string };

/**
 * Tries the live call, falls back to the mock.
 *
 * The fallback is unconditional on purpose: no key, a 429, a truncated response,
 * or a schema mismatch all land in the same place. A knowledge base with a
 * placeholder pitch is a working result; a failed scrape is not
 * (`prompts/README.md`, "Degradation and validation").
 */
async function run<T>(
  promptId: PromptId,
  live: () => Promise<{ ok: true; value: T } | { ok: false; reason: string }>,
  mock: () => T,
): Promise<Ran<T>> {
  void promptId;
  if (hasApiKey()) {
    const outcome = await live();
    if (outcome.ok) return { value: outcome.value, source: "live" };
    return { value: mock(), source: "mock", reason: outcome.reason };
  }
  return { value: mock(), source: "mock", reason: "no-api-key" };
}

function report<T>(ran: Ran<T>, promptId: PromptId, filled: string[]): PromptReport {
  return {
    promptId,
    source: ran.source,
    ...(ran.reason ? { reason: ran.reason } : {}),
    filled,
  };
}

function methodFor(source: EnrichmentSource): ExtractionMethod {
  return source === "live" ? "ai-live" : "ai-mock";
}

/* ---------------------------------------------------------------- prompt 01 */

type GeneratedField = {
  value: string | null;
  confidence: number;
  sourceUrls: string[];
};

type GeneratedListField = {
  value: string[];
  confidence: number;
  sourceUrls: string[];
};

function profileFields(
  response: CompanyProfileResponse,
): Array<[string, GeneratedField]> {
  return [
    ["foundation.overview", response.overview],
    ["foundation.industry", response.industry],
    ["foundation.businessModel", response.businessModel],
    ["foundation.companyRole", response.companyRole],
    ["positioning.pitch", response.pitch],
    ["positioning.foundingStory", response.foundingStory],
    ["market.customerNeeds", response.customerNeeds],
    ["market.idealPersona", response.idealPersona],
  ];
}

function profileListFields(
  response: CompanyProfileResponse,
): Array<[string, GeneratedListField]> {
  return [
    ["foundation.serviceLocations", response.serviceLocations],
    ["market.buyers", response.buyers],
  ];
}

/**
 * Fields the schema documents as generated, where an extracted value is a seed
 * rather than an answer.
 *
 * `foundation.overview` is the case: the metadata extractor claims it from
 * `<meta name="description">` at confidence 0.35–0.55 precisely because SEO copy
 * is not a company summary. Treating that as "already filled" would mean the
 * overview prompt never wrote anything on any site that has a meta description
 * — which is all of them.
 */
const AI_OWNED_PATHS = new Set([
  "foundation.overview",
  "positioning.pitch",
  "positioning.foundingStory",
  "market.customerNeeds",
  "market.idealPersona",
]);

/** A seed below this confidence gives way to a generated value. */
const SEED_CONFIDENCE = 0.6;

/**
 * Writes one generated field, or declines to.
 *
 * Declines when the model returned `null` (the answer the prompt asks for when
 * evidence is thin) or when the field already holds something we actually
 * scraped. Returns `null` for "not written" so the caller can report what
 * changed.
 */
function applyGenerated(
  kb: KnowledgeBase,
  path: string,
  field: GeneratedField,
  source: EnrichmentSource,
  knownUrls: Set<string>,
): KnowledgeBase | null {
  if (field.value === null || field.value.trim() === "") return null;

  const existing = getPath(kb, path) as Sourced<unknown> | undefined;
  if (isFilled(existing)) {
    const replaceable =
      AI_OWNED_PATHS.has(path) &&
      existing !== undefined &&
      existing.confidence < SEED_CONFIDENCE &&
      field.confidence > existing.confidence;
    if (!replaceable) return null;
  }

  return setPath(kb, path, {
    value: field.value,
    method: methodFor(source),
    confidence: clamp(field.confidence),
    // A model may cite a URL it inferred rather than one it was shown. Keeping
    // only pages we fetched means the review UI's "where did this come from"
    // link always resolves.
    sourceUrls: field.sourceUrls.filter((url) => knownUrls.has(url)),
    ...(source === "mock" ? { note: MOCK_NOTE } : {}),
  } satisfies Sourced<string>);
}

/**
 * Writes a generated list field, merging rather than replacing.
 *
 * `serviceLocations` is the case that decides the shape: the extractor finds
 * "Texas Hill Country" in the header, the model reads nine more towns out of the
 * footer copy, and both are right. A generated value never displaces a scraped
 * one, so the extracted entries keep their position and only genuinely new
 * strings are appended.
 */
function applyGeneratedList(
  kb: KnowledgeBase,
  path: string,
  field: GeneratedListField,
  source: EnrichmentSource,
  knownUrls: Set<string>,
): KnowledgeBase | null {
  const incoming = field.value
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (incoming.length === 0) return null;

  const existingField = getPath(kb, path) as Sourced<string[]> | undefined;
  const existing = existingField?.value ?? [];
  const seen = new Set(existing.map((item) => item.toLowerCase()));

  const added = incoming.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (added.length === 0) return null;

  return setPath(kb, path, {
    value: [...existing, ...added],
    // A merged list is only as trustworthy as its weakest half, and the AI half
    // is the weaker one — so the whole field carries the generated badge.
    method: methodFor(source),
    confidence: clamp(field.confidence),
    sourceUrls: [
      ...new Set([
        ...(existingField?.sourceUrls ?? []),
        ...field.sourceUrls.filter((url) => knownUrls.has(url)),
      ]),
    ],
    ...(source === "mock" ? { note: MOCK_NOTE } : {}),
  } satisfies Sourced<string[]>);
}

/* ---------------------------------------------------------------- prompt 02 */

/**
 * Turns the model's consolidated catalogue back into `Offering` records.
 *
 * Two constraints from `prompts/02-offering-normalization.md` are enforced here
 * rather than trusted:
 *
 * - **Traceability.** An offering with no valid candidate index is one the model
 *   added, and the prompt forbids adding offerings the company did not list.
 * - **Verbatim pricing.** A price is copied only if a source candidate stated
 *   that price. This is the field an SMB is most likely to be held to.
 */
function consolidateOfferings(
  response: OfferingNormalizationResponse,
  candidates: Offering[],
  source: EnrichmentSource,
): Offering[] {
  const out: Offering[] = [];

  for (const offering of response.offerings) {
    const indexes = offering.sourceCandidateIndexes.filter(
      (index) => index >= 0 && index < candidates.length,
    );
    if (indexes.length === 0) continue;

    const sources = indexes.map((index) => candidates[index]);
    const statedPrices = sources
      .map((candidate) => candidate.pricing)
      .filter((price): price is string => Boolean(price));

    const pricing =
      offering.pricing && statedPrices.some((price) => priceMatches(price, offering.pricing!))
        ? offering.pricing
        : (statedPrices[0] ?? null);

    out.push({
      id: sources[0].id,
      method: methodFor(source),
      confidence: clamp(offering.confidence),
      sourceUrls: [...new Set(sources.flatMap((candidate) => candidate.sourceUrls))],
      name: offering.name,
      category: offering.category,
      description: offering.description.trim() || null,
      features: offering.features,
      pricing,
      // The model is not given URLs per candidate beyond the first, so the
      // canonical link stays whatever the extractor found.
      url: sources.find((candidate) => candidate.url)?.url ?? null,
      sourceCandidateIndexes: indexes,
    });
  }

  return out;
}

function priceMatches(stated: string, returned: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s,]/g, "");
  return (
    normalize(stated).includes(normalize(returned)) ||
    normalize(returned).includes(normalize(stated))
  );
}

/* ---------------------------------------------------------------- prompt 04 */

type ProofApplication = {
  knowledgeBase: KnowledgeBase;
  filled: string[];
  droppedQuotes: number;
};

function applyProof(
  kb: KnowledgeBase,
  response: ProofExtractionResponse,
  source: EnrichmentSource,
  input: EnrichmentInput,
): ProofApplication {
  const method = methodFor(source);
  const corpus = verificationCorpus(input);
  const filled: string[] = [];

  // The verification layer. Anything the model could not have copied from the
  // pages it was shown never reaches the knowledge base.
  const verified = keepVerbatimQuotes(
    response.testimonials,
    (testimonial) => testimonial.quote,
    corpus,
  );

  const peopleByName = new Map(
    input.knownPeople.map((person) => [person.name.toLowerCase(), person.id]),
  );

  const testimonials: Testimonial[] = verified.kept.map((testimonial) => ({
    id: newId(),
    method,
    confidence: clamp(testimonial.confidence),
    sourceUrls: [testimonial.sourceUrl],
    quote: testimonial.quote,
    authorName: testimonial.authorName,
    authorRole: testimonial.authorRole,
    authorCompany: null,
    authorLocation: null,
    rating: testimonial.rating === null ? null : clampRating(testimonial.rating),
    date: null,
    platform: null,
    mediaUrl: null,
    topics: testimonial.topics,
    // Names the model reports that match no extracted person are dropped rather
    // than stored as free text: the field is a foreign key into `people[]`.
    mentionsPeople: testimonial.mentionsPeople
      .map((name) => peopleByName.get(name.toLowerCase()))
      .filter((id): id is string => Boolean(id)),
    mentionsOfferings: [],
  }));

  let next = kb;

  next = mergeRecords(next, "proof.testimonials", testimonials, (record) =>
    quoteKey(record.quote),
  );
  if (testimonials.length > 0) filled.push(`proof.testimonials +${testimonials.length}`);

  /* ------------------------------------------------------- credentials */

  const credentials: Credential[] = [];
  const memberships: Credential[] = [];
  const awards: Award[] = [];

  for (const credential of response.credentials) {
    if (credential.kind === "award") {
      awards.push({
        id: newId(),
        method,
        confidence: clamp(credential.confidence),
        sourceUrls: [credential.sourceUrl],
        name: credential.name,
        issuer: credential.issuer,
        year: null,
      });
      continue;
    }

    const record: Credential = {
      id: newId(),
      method,
      confidence: clamp(credential.confidence),
      sourceUrls: [credential.sourceUrl],
      name: credential.name,
      issuer: credential.issuer,
      identifier: null,
      validUntil: null,
      verifyUrl: null,
      kind: credential.kind,
    };
    if (credential.kind === "membership") memberships.push(record);
    else credentials.push(record);
  }

  const byName = (record: { name: string }) => record.name.toLowerCase();
  next = mergeRecords(next, "proof.certifications", credentials, byName);
  next = mergeRecords(next, "proof.memberships", memberships, byName);
  next = mergeRecords(next, "proof.awards", awards, byName);
  if (credentials.length > 0) filled.push(`proof.certifications +${credentials.length}`);
  if (memberships.length > 0) filled.push(`proof.memberships +${memberships.length}`);
  if (awards.length > 0) filled.push(`proof.awards +${awards.length}`);

  /* -------------------------------------------------------- trust stats */

  const trustStats: TrustStat[] = response.trustStats.map((stat) => ({
    id: newId(),
    method,
    confidence: clamp(stat.confidence),
    sourceUrls: [stat.sourceUrl],
    claim: stat.claim,
    value: stat.value,
    unit: stat.unit,
    category: stat.category,
    asOfDate: null,
  }));

  next = mergeRecords(next, "proof.trustStats", trustStats, (record) =>
    record.claim.toLowerCase(),
  );
  if (trustStats.length > 0) filled.push(`proof.trustStats +${trustStats.length}`);

  return { knowledgeBase: next, filled, droppedQuotes: verified.dropped.length };
}

/**
 * Appends records to a collection, keeping what the extractors already found.
 *
 * Scraped records win a key collision: a testimonial read directly out of the
 * DOM has better provenance than the same quote round-tripped through a model.
 */
function mergeRecords<T extends { id: string }>(
  kb: KnowledgeBase,
  path: string,
  incoming: T[],
  keyOf: (record: T) => string,
): KnowledgeBase {
  if (incoming.length === 0) return kb;

  const field = getPath(kb, path) as Sourced<T[]> | undefined;
  const existing = field?.value ?? [];
  const seen = new Set(existing.map(keyOf));

  const added = incoming.filter((record) => {
    const key = keyOf(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (added.length === 0) return kb;

  const value = [...existing, ...added];
  return setPath(kb, path, {
    value,
    // The collection's own method reflects the best provenance in it, which is
    // whatever the extractors contributed if they contributed anything.
    method: existing.length > 0 ? (field?.method ?? "scraped") : methodOf(added[0]),
    confidence: average(value.map((record) => (record as { confidence?: number }).confidence ?? 0)),
    sourceUrls: field?.sourceUrls ?? [],
    ...(field?.note ? { note: field.note } : {}),
  } satisfies Sourced<T[]>);
}

function methodOf(record: unknown): ExtractionMethod {
  const method = (record as { method?: ExtractionMethod }).method;
  return method ?? "ai-mock";
}

/* ------------------------------------------------------------------ input */

/**
 * Assembles the evidence bundle the prompts share.
 *
 * `extractedFacts` is the load-bearing part: sending the scalars we already know
 * stops the model re-deriving a phone number from body text and disagreeing with
 * the JSON-LD, and it is what lets prompt 01's rules say "treat as reliable".
 */
export function buildEnrichmentInput(
  kb: KnowledgeBase,
  pages: Array<{ url: string; role: EnrichmentInput["pages"][number]["role"]; text: string }>,
  metrics: EnrichmentInput["metrics"],
): EnrichmentInput {
  const facts: EnrichmentInput["extractedFacts"] = [];

  for (const meta of FIELD_META) {
    if (meta.kind === "records" || meta.kind === "composite") continue;
    const field = getPath(kb, meta.path) as Sourced<unknown> | undefined;
    if (!isFilled(field) || !field) continue;
    // Generated fields are what we are about to ask for; feeding a previous
    // answer back in would launder a guess into "already extracted".
    if (field.method === "ai-live" || field.method === "ai-mock") continue;

    const value = formatFact(field.value);
    if (!value) continue;
    facts.push({ label: meta.label, value, sourceUrl: field.sourceUrls[0] ?? kb.sourceUrl });
  }

  const people = (kb.people.value ?? []).map((person) => ({
    id: person.id,
    name: person.name,
  }));

  return {
    companyName: kb.companyName.value,
    websiteUrl: kb.sourceUrl,
    industry: kb.foundation.industry.value,
    pages,
    extractedFacts: facts,
    offeringCandidates: kb.offerings.value ?? [],
    metrics,
    ctas: kb.market.ctas.value ?? [],
    knownPeople: people,
  };
}

function formatFact(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => formatFact(item)).filter(Boolean);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.formatted === "string") return record.formatted;
    return null;
  }
  return String(value);
}

/* ---------------------------------------------------------------- helpers */

function clamp(value: number): number {
  if (!Number.isFinite(value)) return MOCK_CONFIDENCE;
  return Math.min(1, Math.max(0, value));
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(0, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}
