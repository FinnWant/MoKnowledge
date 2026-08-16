import { describe, expect, it } from "vitest";
import { capturedSlugs, loadCrawlResult } from "../fixtures/load";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { knowledgeBaseSchema, SCRAPER_VERSION } from "@/lib/schema";

/**
 * The whole extraction pipeline over the golden fixtures.
 *
 * P3's acceptance criterion is "all golden sites produce schema-valid knowledge
 * bases", and that is checked here rather than only in `npm run validate`, so a
 * regression fails CI instead of a report a human has to read.
 */

const CLOCK = new Date("2026-02-13T00:00:00.000Z");
const slugs = capturedSlugs();

const built = new Map(
  slugs.map((slug) => [
    slug,
    buildKnowledgeBase(loadCrawlResult(slug), { now: CLOCK, enrich: false }),
  ]),
);

describe.each(slugs)("pipeline — %s", (slug) => {
  const { knowledgeBase: kb, metrics, pageTexts } = built.get(slug)!;

  it("produces a schema-valid knowledge base", () => {
    const parsed = knowledgeBaseSchema.safeParse(kb);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("identifies the company and its website", () => {
    expect(kb.companyName.value).toBeTruthy();
    expect(kb.foundation.website.value).toBeTruthy();
  });

  it("records the crawl in scrape metadata", () => {
    expect(kb.scrape.pages.length).toBe(pageTexts.length);
    expect(kb.scrape.pages.length).toBeLessThanOrEqual(20);
    expect(kb.scrape.scraperVersion).toBe(SCRAPER_VERSION);
  });

  it("scores quality and asks at most six questions", () => {
    expect(kb.quality.overallScore).toBeGreaterThan(0);
    expect(kb.quality.categoryScores).toHaveLength(9);
    expect(kb.quality.followUpQuestions.length).toBeLessThanOrEqual(6);
  });

  it("reads enough text to analyze the voice", () => {
    expect(metrics.wordCount).toBeGreaterThan(100);
  });

  it("labels nothing as AI when enrichment is off", () => {
    const methods = JSON.stringify(kb);
    expect(methods).not.toMatch(/"method":"ai-(live|mock)"/);
  });

  it("never leaks an unresolved CSS variable into fonts or colors", () => {
    // The defect ROADMAP §2.3 found in the reference output.
    for (const font of kb.branding.fonts.value ?? []) {
      expect(font).not.toMatch(/var\(|--/);
    }
    for (const color of kb.branding.colors.value ?? []) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("marks every empty field as looked-for rather than absent", () => {
    for (const path of kb.quality.missingFields) {
      const field = path
        .split(".")
        .reduce<Record<string, unknown> | undefined>(
          (node, key) => node?.[key] as Record<string, unknown> | undefined,
          kb as unknown as Record<string, unknown>,
        );
      expect(field).toBeDefined();
      expect((field as { value: unknown }).value === null || Array.isArray((field as { value: unknown }).value)).toBe(true);
    }
  });
});

describe("pipeline determinism", () => {
  it("produces the same knowledge base twice, ids aside", { timeout: 60_000 }, () => {
    const slug = slugs[0];
    const first = buildKnowledgeBase(loadCrawlResult(slug), { now: CLOCK, enrich: false });
    const second = buildKnowledgeBase(loadCrawlResult(slug), { now: CLOCK, enrich: false });

    // Record ids are `crypto.randomUUID()` by design, and cross-references
    // carry them too, so every UUID is masked rather than just the `id` key.
    const strip = (value: unknown) =>
      JSON.stringify(value).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        "·",
      );

    expect(strip(first.knowledgeBase)).toBe(strip(second.knowledgeBase));
  });
});
