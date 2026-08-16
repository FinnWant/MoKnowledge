import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEnrichmentInput, enrich } from "@/lib/ai/enrich";
import { mockCompanyProfile, mockOfferings, mockProof, mockWritingStyle } from "@/lib/ai/mock-enrich";
import { isVerbatim, keepVerbatimQuotes, normalizeForMatch } from "@/lib/ai/verify";
import {
  renderCompanyProfileMessage,
  renderOfferingMessage,
  renderPageExcerpts,
  renderProofMessage,
  renderWritingStyleMessage,
  type EnrichmentInput,
} from "@/lib/ai/messages";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { loadCrawlResult, capturedSlugs } from "../fixtures/load";
import { knowledgeBaseSchema, type KnowledgeBase } from "@/lib/schema";

/**
 * Enrichment, on both paths.
 *
 * The live path is exercised with a stubbed SDK rather than a real key: the
 * things worth testing — verbatim verification, traceable offerings,
 * `ai-live` labelling, refusal to overwrite scraped values — are all our code,
 * and none of them should need a network call to prove.
 */

const slug = capturedSlugs()[0];

// Built once: extracting a 20-page fixture site takes seconds, and every test
// below reads the same immutable result.
const EXTRACTION = buildKnowledgeBase(loadCrawlResult(slug), {
  now: new Date("2026-02-13T00:00:00.000Z"),
  enrich: false,
});

const INPUT: EnrichmentInput = buildEnrichmentInput(
  EXTRACTION.knowledgeBase,
  EXTRACTION.pageTexts,
  EXTRACTION.metrics,
);

function extraction() {
  return EXTRACTION;
}

function input(): EnrichmentInput {
  return INPUT;
}

/** Reads a `Sourced<T>` off the knowledge base by dot path. */
function readField(kb: KnowledgeBase, path: string) {
  return path.split(".").reduce<Record<string, unknown>>(
    (node, key) => node[key] as Record<string, unknown>,
    kb as unknown as Record<string, unknown>,
  ) as unknown as { method: string; note?: string };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- messages */

describe("user messages", () => {
  it("renders prompt 01's documented template", () => {
    const message = renderCompanyProfileMessage(input());

    expect(message).toMatch(/^Company: /);
    expect(message).toContain("Structured facts already extracted (treat as reliable):");
    expect(message).toContain("Page excerpts:");
    expect(message).toMatch(/--- https?:\/\/\S+ \(role: \w[\w-]*\) ---/);
  });

  it("orders excerpts by page value and stays inside the budget", () => {
    const pages = [
      { url: "https://x.com/blog/a", role: "blog-post" as const, text: "b".repeat(9_000) },
      { url: "https://x.com/", role: "home" as const, text: "h".repeat(9_000) },
    ];
    const excerpts = renderPageExcerpts(pages);

    expect(excerpts.indexOf("https://x.com/ ")).toBeLessThan(excerpts.indexOf("blog/a"));
    // 4k per page, so neither block carries its full 9k.
    expect(excerpts.length).toBeLessThan(10_000);
  });

  it("numbers offering candidates so a merge can cite them", () => {
    const message = renderOfferingMessage(input());
    if (input().offeringCandidates.length > 0) {
      expect(message).toMatch(/\[0\] name: /);
    }
  });

  it("gives prompt 03 the computed metrics, not the raw text", () => {
    const message = renderWritingStyleMessage(input());
    expect(message).toContain("Flesch-Kincaid grade level:");
    expect(message).toContain("Representative sentences:");
  });

  it("gives prompt 04 the staff list it links testimonials against", () => {
    expect(renderProofMessage(input())).toContain("Known staff names (for testimonial linking):");
  });
});

/* --------------------------------------------------------------- verify */

describe("quote verification", () => {
  const source =
    "They drilled our well in two days and cleaned up every scrap. “Outstanding work,” said the foreman.";

  it("accepts a quote that differs only in typography", () => {
    expect(isVerbatim("They drilled our well in two days", source)).toBe(true);
    // Smart quotes and the comma inside them are normalized away, so the quote
    // still matches the source it was copied from.
    expect(isVerbatim("Outstanding work", source)).toBe(true);
    // Below ten normalized characters there is not enough to verify.
    expect(isVerbatim("well", source)).toBe(false);
    // Dashes collapse to one form so an em dash and a hyphen compare equal.
    expect(normalizeForMatch("“Smart—quotes”")).toBe("smart-quotes");
  });

  it("rejects a paraphrase", () => {
    expect(isVerbatim("They drilled our well in a couple of days", source)).toBe(false);
  });

  it("drops unverifiable quotes instead of flagging them", () => {
    const result = keepVerbatimQuotes(
      [{ quote: "cleaned up every scrap" }, { quote: "the best crew in Texas" }],
      (item) => item.quote,
      source,
    );

    expect(result.kept).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/verbatim/);
  });
});

/* ----------------------------------------------------------------- mock */

describe("mock generator", () => {
  it("is deterministic", () => {
    const evidence = input();
    expect(mockCompanyProfile(evidence)).toEqual(mockCompanyProfile(evidence));
    expect(mockWritingStyle(evidence)).toEqual(mockWritingStyle(evidence));
  });

  it("never invents a founding story, a business model, or a service area", () => {
    const profile = mockCompanyProfile(input());

    expect(profile.foundingStory.value).toBeNull();
    expect(profile.businessModel.value).toBeNull();
    expect(profile.companyRole.value).toBeNull();
    expect(profile.serviceLocations.value).toEqual([]);
  });

  it("never invents proof", () => {
    // The one place fabrication would attribute words to a named person.
    expect(mockProof()).toEqual({ testimonials: [], credentials: [], trustStats: [] });
  });

  it("describes the writing style from the measurements it was given", () => {
    const evidence = input();
    const style = mockWritingStyle(evidence);

    expect(style.description).toContain(String(evidence.metrics.averageSentenceLength));
    expect(style.tone.length).toBeGreaterThan(0);
    expect(style.avoidTerms).toEqual([]);
  });

  it("only consolidates offerings that came from candidates", () => {
    const evidence = input();
    const consolidated = mockOfferings(evidence);

    expect(consolidated.offerings.length).toBeLessThanOrEqual(evidence.offeringCandidates.length);
    for (const offering of consolidated.offerings) {
      expect(offering.sourceCandidateIndexes.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------- without a key */

describe("enrichment without an API key", () => {
  it("fills the same fields and labels every one of them ai-mock", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const { knowledgeBase, report } = await enrich(extraction().knowledgeBase, input());

    expect(report.apiKeyPresent).toBe(false);
    expect(report.prompts).toHaveLength(4);
    expect(report.prompts.every((prompt) => prompt.source === "mock")).toBe(true);
    expect(report.prompts.every((prompt) => prompt.reason === "no-api-key")).toBe(true);

    // Whatever it filled is badged as a sample and says why, so nothing mocked
    // can be mistaken for something generated or scraped.
    const filled = report.prompts.flatMap((prompt) => prompt.filled).filter((path) => path.includes("."));
    expect(filled.length).toBeGreaterThan(0);
    for (const path of filled) {
      const field = readField(knowledgeBase, path);
      expect(field.method).toBe("ai-mock");
      expect(field.note).toMatch(/ANTHROPIC_API_KEY/);
    }

    expect(knowledgeBase.branding.writingStyle.method).toBe("ai-mock");
    expect(knowledgeBase.branding.writingStyle.value?.description).toBeTruthy();
    expect(knowledgeBaseSchema.safeParse(knowledgeBase).success).toBe(true);
  });

  it("leaves scraped values alone", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const before = extraction().knowledgeBase;
    const { knowledgeBase: after } = await enrich(before, input());

    for (const path of ["companyName", "foundation.phone", "foundation.website"] as const) {
      const read = (kb: KnowledgeBase) =>
        path.split(".").reduce<Record<string, unknown>>(
          (node, key) => node[key] as Record<string, unknown>,
          kb as unknown as Record<string, unknown>,
        );
      expect(read(after)).toEqual(read(before));
    }
  });
});

/* ------------------------------------------------------------ with a key */

describe("enrichment with a stubbed live client", () => {
  async function runWithResponse(payload: unknown) {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(payload) }],
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { enrich: freshEnrich } = await import("@/lib/ai/enrich");
    const evidence = input();
    const result = await freshEnrich(extraction().knowledgeBase, evidence);
    return { ...result, create, evidence };
  }

  it("labels live output ai-live and keeps only verifiable quotes", async () => {
    const evidence = input();
    const corpus = renderPageExcerpts(evidence.pages);
    const realSentence = corpus.slice(500, 560);

    const { knowledgeBase, report } = await runWithResponse({
      // One response object is enough: every prompt's schema is satisfied by
      // the union of these keys, and each call reads only its own.
      overview: { value: "A generated overview.", confidence: 0.8, sourceUrls: [evidence.pages[0].url] },
      industry: { value: null, confidence: 0, sourceUrls: [] },
      businessModel: { value: "b2c", confidence: 0.7, sourceUrls: [] },
      companyRole: { value: null, confidence: 0, sourceUrls: [] },
      serviceLocations: { value: ["Austin"], confidence: 0.6, sourceUrls: [] },
      pitch: { value: null, confidence: 0, sourceUrls: [] },
      foundingStory: { value: null, confidence: 0, sourceUrls: [] },
      customerNeeds: { value: null, confidence: 0, sourceUrls: [] },
      idealPersona: { value: null, confidence: 0, sourceUrls: [] },
      buyers: { value: [], confidence: 0, sourceUrls: [] },
      offerings: [],
      description: "Generated style description.",
      tone: ["professional"],
      formality: "neutral",
      readerAddress: "mixed",
      preferredTerms: [],
      avoidTerms: [],
      ctaStyle: "Direct.",
      confidence: 0.7,
      testimonials: [
        {
          quote: realSentence,
          authorName: "Karen M.",
          authorRole: null,
          rating: 5,
          sourceUrl: evidence.pages[0].url,
          topics: [],
          mentionsPeople: ["Nobody By That Name"],
          confidence: 0.8,
        },
        {
          quote: "This customer never said any of these particular words at all.",
          authorName: "Invented Person",
          authorRole: null,
          rating: 5,
          sourceUrl: evidence.pages[0].url,
          topics: [],
          mentionsPeople: [],
          confidence: 0.9,
        },
      ],
      credentials: [
        { name: "Licensed Water Well Driller", issuer: "TDLR", kind: "license", sourceUrl: evidence.pages[0].url, confidence: 0.9 },
        { name: "Best of Austin 2024", issuer: null, kind: "award", sourceUrl: evidence.pages[0].url, confidence: 0.8 },
      ],
      trustStats: [],
    });

    expect(report.apiKeyPresent).toBe(true);
    expect(report.prompts.every((prompt) => prompt.source === "live")).toBe(true);
    expect(knowledgeBase.foundation.overview.method).toBe("ai-live");
    expect(knowledgeBase.foundation.overview.note).toBeUndefined();

    // The fabricated quote is gone; the real one stayed.
    const quotes = (knowledgeBase.proof.testimonials.value ?? []).map((item) => item.quote);
    expect(quotes).not.toContain("This customer never said any of these particular words at all.");
    expect(report.droppedQuotes).toBe(1);

    // A name matching no extracted person is not stored as a dangling link.
    const live = (knowledgeBase.proof.testimonials.value ?? []).find(
      (item) => item.authorName === "Karen M.",
    );
    expect(live?.mentionsPeople).toEqual([]);

    // Credentials route by kind: an award is not a certification.
    expect((knowledgeBase.proof.awards.value ?? []).map((award) => award.name)).toContain(
      "Best of Austin 2024",
    );
    expect((knowledgeBase.proof.certifications.value ?? []).map((item) => item.name)).toContain(
      "Licensed Water Well Driller",
    );

    expect(knowledgeBaseSchema.safeParse(knowledgeBase).success).toBe(true);
  });

  it("drops an offering the model did not trace to a candidate", async () => {
    const { knowledgeBase, report, evidence } = await runWithResponse({
      overview: { value: null, confidence: 0, sourceUrls: [] },
      industry: { value: null, confidence: 0, sourceUrls: [] },
      businessModel: { value: null, confidence: 0, sourceUrls: [] },
      companyRole: { value: null, confidence: 0, sourceUrls: [] },
      serviceLocations: { value: [], confidence: 0, sourceUrls: [] },
      pitch: { value: null, confidence: 0, sourceUrls: [] },
      foundingStory: { value: null, confidence: 0, sourceUrls: [] },
      customerNeeds: { value: null, confidence: 0, sourceUrls: [] },
      idealPersona: { value: null, confidence: 0, sourceUrls: [] },
      buyers: { value: [], confidence: 0, sourceUrls: [] },
      offerings: [
        {
          name: "A Service They Actually List",
          category: "service",
          description: "Merged from a real candidate.",
          features: [],
          pricing: "$4,000,000",
          sourceCandidateIndexes: [0],
          confidence: 0.8,
        },
        {
          name: "A Service Nobody Mentioned",
          category: "service",
          description: "Invented.",
          features: [],
          pricing: null,
          sourceCandidateIndexes: [],
          confidence: 0.9,
        },
      ],
      description: "Style.",
      tone: [],
      formality: "neutral",
      readerAddress: "mixed",
      preferredTerms: [],
      avoidTerms: [],
      ctaStyle: "",
      confidence: 0.5,
      testimonials: [],
      credentials: [],
      trustStats: [],
    });

    if (evidence.offeringCandidates.length === 0) return;

    const names = (knowledgeBase.offerings.value ?? []).map((offering) => offering.name);
    expect(names).toContain("A Service They Actually List");
    expect(names).not.toContain("A Service Nobody Mentioned");
    expect(report.droppedOfferings).toBe(1);

    // An invented price is not copied: no candidate stated $4,000,000.
    const kept = (knowledgeBase.offerings.value ?? []).find(
      (offering) => offering.name === "A Service They Actually List",
    );
    expect(kept?.pricing).not.toBe("$4,000,000");
  });

  it("falls back to the mock when the response does not validate", async () => {
    const { knowledgeBase, report } = await runWithResponse({ nonsense: true });

    // A knowledge base with a placeholder pitch beats a failed scrape
    // (prompts/README.md, "Degradation and validation").
    expect(report.prompts.every((prompt) => prompt.source === "mock")).toBe(true);
    expect(report.prompts[0].reason).toMatch(/schema-mismatch/);
    expect(knowledgeBase.branding.writingStyle.method).toBe("ai-mock");
    expect(knowledgeBaseSchema.safeParse(knowledgeBase).success).toBe(true);
  });
});
