import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  derived,
  needsReview,
  notFound,
  scraped,
  sourced,
  userEdited,
} from "@/lib/schema/sourced";

const yearFounded = sourced(z.number());

describe("sourced envelope", () => {
  it("validates a scraped value", () => {
    const parsed = yearFounded.parse(scraped(1980, "https://example.com/about"));
    expect(parsed.value).toBe(1980);
    expect(parsed.method).toBe("scraped");
    expect(parsed.sourceUrls).toEqual(["https://example.com/about"]);
  });

  it("treats a missing value as valid, not an error", () => {
    // The whole point: ~half of a typical scrape is legitimately absent.
    expect(() => yearFounded.parse(notFound())).not.toThrow();
    expect(notFound<number>().value).toBeNull();
  });

  it("carries a note explaining an absence", () => {
    const field = notFound<number>("Birdeye widget detected; content is JS-rendered");
    expect(yearFounded.parse(field).note).toContain("JS-rendered");
  });

  it("rejects confidence outside 0–1", () => {
    expect(() => yearFounded.parse({ ...scraped(1980, "u"), confidence: 1.5 })).toThrow();
  });

  it("preserves provenance when a user corrects a value", () => {
    const original = scraped(1980, "https://example.com/about");
    const edited = userEdited(1985, original);
    expect(edited.method).toBe("user-edited");
    expect(edited.confidence).toBe(1);
    expect(edited.sourceUrls).toEqual(original.sourceUrls);
  });
});

describe("needsReview", () => {
  it("flags low-confidence derived values", () => {
    expect(needsReview(derived(1980, ["https://example.com"], 0.25))).toBe(true);
  });

  it("leaves high-confidence scraped values alone", () => {
    expect(needsReview(scraped(1980, "https://example.com"))).toBe(false);
  });

  it("flags any conflict, regardless of confidence", () => {
    const conflicted = { ...scraped("512-273-7389", "https://example.com"), note: "2 candidates" };
    expect(needsReview(conflicted)).toBe(true);
  });

  it("flags AI-generated prose so a human always sees it", () => {
    const pitch = {
      value: "We drill wells.",
      method: "ai-mock" as const,
      confidence: 0.9,
      sourceUrls: [],
    };
    expect(needsReview(pitch)).toBe(true);
  });

  it("does not flag a missing value — that is the gap-question path, not review", () => {
    expect(needsReview(notFound<number>())).toBe(false);
  });

  it("clears review once the user has edited the field", () => {
    expect(needsReview(userEdited(1985))).toBe(false);
  });
});
