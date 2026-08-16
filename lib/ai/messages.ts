import type { Offering, PageRole } from "@/lib/schema";
import type { TextMetrics } from "@/lib/scraper/analyzers/text";

/**
 * Renders the user-message templates documented in `prompts/*.md`.
 *
 * The templates in those files are written in Handlebars notation because that
 * is the clearest way to show a reviewer what the model receives. They are not
 * executed as Handlebars — pulling in a template engine to interpolate four
 * strings would be a dependency for nothing. These functions are the templates,
 * and `tests/ai/messages.test.ts` pins their shape against the documented one.
 */

/** Per-page excerpt budget. Enough for a full services page; not a whole blog. */
const MAX_PAGE_CHARS = 4_000;

/**
 * Whole-corpus budget. At roughly four characters per token this is ~15k tokens
 * of evidence, which leaves the 16k output budget room on a 200k window even
 * with the system block and thinking.
 */
const MAX_TOTAL_CHARS = 60_000;

export type EnrichmentPage = {
  url: string;
  role: PageRole;
  text: string;
};

export type ExtractedFact = {
  label: string;
  value: string;
  sourceUrl: string;
};

/** Everything the four prompts draw on, assembled once per scrape. */
export type EnrichmentInput = {
  companyName: string | null;
  websiteUrl: string;
  industry: string | null;
  pages: EnrichmentPage[];
  /** Deterministically extracted scalars, so the model never re-derives them. */
  extractedFacts: ExtractedFact[];
  offeringCandidates: Offering[];
  metrics: TextMetrics;
  ctas: string[];
  knownPeople: Array<{ id: string; name: string }>;
};

/* --------------------------------------------------------------- excerpts */

/**
 * Page excerpts under a total budget, highest-value roles first.
 *
 * Truncating by role rather than by crawl order matters on a site with twelve
 * blog posts: the About page must survive the cut, and a blog post is the first
 * thing that should not.
 */
const ROLE_PRIORITY: Record<PageRole, number> = {
  home: 0,
  about: 1,
  services: 2,
  products: 3,
  pricing: 4,
  team: 5,
  testimonials: 6,
  faq: 7,
  contact: 8,
  "blog-index": 9,
  "blog-post": 10,
  other: 11,
  legal: 12,
};

export function renderPageExcerpts(pages: EnrichmentPage[]): string {
  const ordered = [...pages].sort(
    (a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role],
  );

  const blocks: string[] = [];
  let budget = MAX_TOTAL_CHARS;

  for (const page of ordered) {
    if (budget <= 0) break;
    const text = page.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const excerpt = text.slice(0, Math.min(MAX_PAGE_CHARS, budget));
    budget -= excerpt.length;
    blocks.push(`--- ${page.url} (role: ${page.role}) ---\n${excerpt}`);
  }

  return blocks.join("\n\n");
}

/* ----------------------------------------------------- 01 company profile */

export function renderCompanyProfileMessage(input: EnrichmentInput): string {
  const facts = input.extractedFacts
    .map((fact) => `- ${fact.label}: ${fact.value}   [from ${fact.sourceUrl}]`)
    .join("\n");

  return [
    `Company: ${input.companyName ?? "(name not found on the site)"}`,
    `Website: ${input.websiteUrl}`,
    `Industry (extracted): ${input.industry ?? "(not found)"}`,
    "",
    "Structured facts already extracted (treat as reliable):",
    facts || "(none extracted)",
    "",
    "Page excerpts:",
    renderPageExcerpts(input.pages),
  ].join("\n");
}

/* ------------------------------------------------ 02 offering normalization */

export function renderOfferingMessage(input: EnrichmentInput): string {
  const candidates = input.offeringCandidates.map((candidate, index) => {
    const source = candidate.sourceUrls[0] ?? input.websiteUrl;
    return [
      `[${index}] name: ${candidate.name}`,
      `    source: ${source} (${candidate.method})`,
      `    description: ${candidate.description ?? "(none)"}`,
      `    features: ${candidate.features.join("; ") || "(none)"}`,
      `    pricing: ${candidate.pricing ?? "(none stated)"}`,
    ].join("\n");
  });

  const pageCount = new Set(
    input.offeringCandidates.flatMap((candidate) => candidate.sourceUrls),
  ).size;

  return [
    `Company: ${input.companyName ?? "(name not found on the site)"}`,
    `Industry: ${input.industry ?? "(not found)"}`,
    "",
    `Candidate offerings (${input.offeringCandidates.length} extracted across ${pageCount} pages):`,
    candidates.join("\n"),
  ].join("\n");
}

/* ------------------------------------------------------- 03 writing style */

export function renderWritingStyleMessage(input: EnrichmentInput): string {
  const metrics = input.metrics;
  const share = (value: number) => `${Math.round(value * 100)}%`;

  return [
    `Company: ${input.companyName ?? "(name not found on the site)"} — ${input.industry ?? "industry not found"}`,
    "",
    `Computed metrics (from ${metrics.wordCount} words in ${metrics.sentenceCount} sentences across ${input.pages.length} pages):`,
    `- Mean sentence length: ${metrics.averageSentenceLength} words (σ ${metrics.sentenceLengthStdDev})`,
    `- Flesch-Kincaid grade level: ${metrics.readingGrade}`,
    `- Sentences using "we"/"our": ${share(metrics.firstPersonPluralRatio)} of all sentences`,
    `- Sentences using "you"/"your": ${share(metrics.secondPersonRatio)} of all sentences`,
    `- Questions: ${share(metrics.questionRatio)} of all sentences`,
    `- Exclamations: ${share(metrics.exclamationRatio)} of all sentences`,
    `- Imperative openers ("Call", "Schedule", "Get"): ${share(metrics.imperativeRatio)} of all sentences`,
    `- Distinctive terms (high relative frequency): ${
      metrics.distinctiveTerms
        .map((entry) => `${entry.term} (${entry.count})`)
        .join(", ") || "(none)"
    }`,
    "",
    "Representative sentences:",
    metrics.exemplarSentences.map((sentence) => `- "${sentence}"`).join("\n") ||
      "(none)",
    "",
    "Calls to action found verbatim:",
    input.ctas.map((cta) => `- "${cta}"`).join("\n") || "(none)",
  ].join("\n");
}

/* ----------------------------------------------------- 04 proof extraction */

export function renderProofMessage(input: EnrichmentInput): string {
  return [
    `Company: ${input.companyName ?? "(name not found on the site)"}`,
    `Industry: ${input.industry ?? "(not found)"}`,
    "",
    "Page excerpts:",
    renderPageExcerpts(input.pages),
    "",
    "Known staff names (for testimonial linking):",
    input.knownPeople
      .map((person) => `- ${person.name} (id: ${person.id})`)
      .join("\n") || "(none found)",
  ].join("\n");
}

/**
 * The corpus prompt 04's quotes are checked against.
 *
 * Must be built from exactly the excerpts the model was shown: verifying against
 * the full page text would pass a quote the model could only have invented,
 * since it never saw the sentence it supposedly copied.
 */
export function verificationCorpus(input: EnrichmentInput): string {
  return renderPageExcerpts(input.pages);
}
