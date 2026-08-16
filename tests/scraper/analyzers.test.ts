import { describe, expect, it } from "vitest";
import { assignColorRoles, contrastRatio, hsl } from "@/lib/scraper/analyzers/palette";
import { analyzeText, countSyllables, extractThemes } from "@/lib/scraper/analyzers/text";
import {
  buildFollowUpQuestions,
  buildQuality,
  isFilled,
  missingFields,
  scoreCategory,
} from "@/lib/scraper/analyzers/completeness";
import {
  buildTaxonomy,
  computeCadence,
  detectHeadlinePatterns,
  findContentGaps,
} from "@/lib/scraper/analyzers/content";
import {
  createEmptyKnowledgeBase,
  derived,
  MAX_FOLLOW_UP_QUESTIONS,
  scraped,
  type BrandColor,
  type ContentItem,
  type Offering,
} from "@/lib/schema";
import { setPath } from "@/lib/utils/path";

/* --------------------------------------------------------------- palette */

function color(hex: string, frequency: number): BrandColor {
  return { id: hex, method: "derived", confidence: 0.7, sourceUrls: [], hex, role: "unknown", frequency };
}

describe("palette", () => {
  it("assigns roles rather than returning flat hex values", () => {
    const roles = assignColorRoles([
      color("#ffffff", 120),
      color("#111827", 60),
      color("#2663eb", 30),
      color("#7ba2f7", 12),
      color("#f97316", 3),
    ]);

    const roleOf = (hex: string) => roles.find((entry) => entry.hex === hex)?.role;
    expect(roleOf("#ffffff")).toBe("background");
    expect(roleOf("#111827")).toBe("text");
    expect(roleOf("#2663eb")).toBe("primary");
    // Accent is the most saturated of what's left, not the next most frequent:
    // an accent is used sparingly by definition.
    expect(roleOf("#f97316")).toBe("accent");
  });

  it("measures contrast the way WCAG does", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(hsl("#ffffff").lightness).toBe(1);
  });
});

/* ------------------------------------------------------------------ text */

describe("text metrics", () => {
  const corpus =
    "We drill water wells across the Texas Hill Country. Our crews handle permitting, drilling, and pump installation. " +
    "Call today for a free estimate! Do you need a new well? We can help you decide.";

  it("computes rhythm, reading grade, and pronoun ratios", () => {
    const metrics = analyzeText(corpus);

    expect(metrics.wordCount).toBeGreaterThan(20);
    expect(metrics.averageSentenceLength).toBeGreaterThan(0);
    expect(metrics.sentenceLengthStdDev).toBeGreaterThanOrEqual(0);
    expect(metrics.firstPersonPluralRatio).toBeGreaterThan(0);
    expect(metrics.questionRatio).toBeGreaterThan(0);
    expect(metrics.exclamationRatio).toBeGreaterThan(0);
  });

  it("returns a zeroed profile for an empty corpus rather than NaN", () => {
    const metrics = analyzeText("");
    expect(metrics).toMatchObject({ wordCount: 0, readingGrade: 0, distinctiveTerms: [] });
    expect(metrics.exemplarSentences).toEqual([]);
  });

  it("counts syllables well enough for a grade level", () => {
    expect(countSyllables("well")).toBe(1);
    expect(countSyllables("drilling")).toBe(2);
    expect(countSyllables("installation")).toBeGreaterThanOrEqual(3);
  });

  it("drops boilerplate that appears on every page from themes", () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({
      url: `https://example.com/${index}`,
      text: "Copyright footer navigation menu. " + (index < 2 ? "Groundwater aquifer aquifer groundwater drilling aquifer groundwater" : "Pumps pumps pressure pumps pressure tanks pressure"),
    }));

    const themes = extractThemes(pages);
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.map((theme) => theme.label.toLowerCase())).not.toContain("navigation");
  });
});

/* ----------------------------------------------------------- completeness */

describe("completeness", () => {
  function halfFilled() {
    let kb = createEmptyKnowledgeBase({ sourceUrl: "https://example.com" });
    kb = setPath(kb, "companyName", scraped("Acme", "https://example.com"));
    kb = setPath(kb, "foundation.website", derived("https://example.com", []));
    kb = setPath(kb, "foundation.phone", scraped("512-273-7389", "https://example.com"));
    return kb;
  }

  it("treats an empty array as unfilled", () => {
    expect(isFilled({ value: [], method: "scraped", confidence: 1, sourceUrls: [] })).toBe(false);
    expect(isFilled({ value: "  ", method: "scraped", confidence: 1, sourceUrls: [] })).toBe(false);
    expect(isFilled({ value: 0, method: "scraped", confidence: 1, sourceUrls: [] })).toBe(true);
  });

  it("scores by impact rather than by fill rate", () => {
    const kb = halfFilled();
    const foundation = scoreCategory(kb, "foundation");

    expect(foundation.filledFields).toBeGreaterThan(0);
    expect(foundation.score).toBeGreaterThan(0);
    expect(foundation.score).toBeLessThan(1);
    expect(missingFields(kb)).toContain("foundation.yearFounded");
  });

  it("caps follow-up questions and orders them by value per unit of effort", () => {
    const questions = buildFollowUpQuestions(halfFilled());

    expect(questions.length).toBeLessThanOrEqual(MAX_FOLLOW_UP_QUESTIONS);
    expect(questions).not.toHaveLength(0);
    const priorities = questions.map((question) => question.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    // Plain language, never a schema key.
    expect(questions.every((question) => /\?$/.test(question.question))).toBe(true);
  });

  it("never asks for a field the customer could not know", () => {
    const questions = buildFollowUpQuestions(createEmptyKnowledgeBase({ sourceUrl: "https://x.com" }));
    const asked = questions.flatMap((question) => question.fills);
    expect(asked).not.toContain("branding.writingStyle");
    expect(asked).not.toContain("market.industryOutlook");
  });

  it("builds the quality block from the knowledge base and its conflicts", () => {
    const quality = buildQuality(halfFilled(), [
      { path: "foundation.phone", label: "phone", candidates: [], resolved: false },
    ]);

    expect(quality.overallScore).toBeGreaterThan(0);
    expect(quality.categoryScores).toHaveLength(9);
    expect(quality.conflicts).toHaveLength(1);
  });
});

/* --------------------------------------------------------------- content */

function post(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: overrides.url ?? "id",
    method: "scraped",
    confidence: 0.7,
    sourceUrls: [],
    title: "A post",
    url: "https://example.com/blog/a",
    publishedAt: null,
    author: null,
    category: null,
    excerpt: null,
    wordCount: null,
    headings: [],
    ...overrides,
  };
}

describe("content analyzers", () => {
  it("flags a blog untouched for 90 days as stale", () => {
    const cadence = computeCadence(
      [
        post({ url: "a", publishedAt: "2025-01-01" }),
        post({ url: "b", publishedAt: "2025-03-01" }),
      ],
      new Date("2026-02-13"),
    );

    expect(cadence?.isStale).toBe(true);
    expect(cadence?.postsPerMonth).toBeGreaterThan(0);
    expect(cadence?.lastPublished).toBe("2025-03-01");
  });

  it("says nothing about cadence when no post carries a date", () => {
    const cadence = computeCadence([post({ url: "a" })], new Date("2026-02-13"));
    expect(cadence).toMatchObject({ postsPerMonth: null, isStale: false });
    expect(computeCadence([], new Date())).toBeNull();
  });

  it("buckets headlines into recognisable patterns", () => {
    const patterns = detectHeadlinePatterns([
      post({ url: "a", title: "How to Choose a Well Pump" }),
      post({ url: "b", title: "5 Signs Your Well Needs Service" }),
      post({ url: "c", title: "Submersible vs. Jet Pumps" }),
    ]);

    expect(patterns.map((pattern) => pattern.pattern)).toEqual(
      expect.arrayContaining(["how-to", "listicle", "comparison"]),
    );
  });

  it("reports an offering with no supporting content as a gap", () => {
    const offering = {
      id: "o1",
      method: "scraped",
      confidence: 0.7,
      sourceUrls: [],
      name: "Cathodic Protection",
      category: null,
      description: null,
      features: [],
      pricing: null,
      url: null,
      sourceCandidateIndexes: [],
    } satisfies Offering;

    const gaps = findContentGaps({
      offerings: [offering],
      posts: [post({ url: "a", title: "Well maintenance tips" })],
      pageUrls: ["https://example.com/"],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].relatedOffering).toBe("o1");
  });

  it("returns no taxonomy rather than an empty one", () => {
    expect(buildTaxonomy([post({ url: "a" })])).toBeNull();
    expect(buildTaxonomy([post({ url: "a", category: "Wells" })])).toEqual({
      categories: ["Wells"],
      tags: [],
    });
  });
});
