import { describe, expect, it } from "vitest";
import { evidence, type Evidence } from "@/lib/scraper/evidence";
import { fieldAt, isCollectionPath, reconcile } from "@/lib/scraper/reconcile";
import { createEmptyKnowledgeBase, type Sourced } from "@/lib/schema";

/**
 * The reconciler's two rules (lib/scraper/reconcile.ts): precedence beats
 * confidence, and same-tier disagreement becomes a conflict rather than a
 * silent pick.
 */

const home = { url: "https://example.com/", role: "home" as const };
const contact = { url: "https://example.com/contact/", role: "contact" as const };

function reconcileClaims(claims: Evidence[]) {
  return reconcile(claims, createEmptyKnowledgeBase({ sourceUrl: "https://example.com" }));
}

describe("scalar reconciliation", () => {
  it("lets a lower-confidence JSON-LD claim beat a confident DOM one", () => {
    const { knowledgeBase, conflicts } = reconcileClaims([
      evidence("foundation.phone", "512-273-7389", "json-ld", home, { confidence: 0.6 }),
      evidence("foundation.phone", "512-894-0055", "dom", contact, { confidence: 0.95 }),
    ]);

    expect(knowledgeBase.foundation.phone.value).toBe("512-273-7389");
    // A DOM value losing to JSON-LD is the precedence chain working, not
    // something worth asking the user about.
    expect(conflicts).toHaveLength(0);
  });

  it("raises a conflict when two same-tier claims disagree", () => {
    const { knowledgeBase, conflicts } = reconcileClaims([
      evidence("foundation.phone", "512-273-7389", "dom", home),
      evidence("foundation.phone", "512-894-0055", "dom", contact),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].candidates).toHaveLength(2);
    expect(conflicts[0].candidates[0].sourceLabel).toMatch(/page/);
    expect(knowledgeBase.foundation.phone.note).toMatch(/2 different values/);
    // A contested value is not a confident one, whatever the extractor claimed.
    expect(knowledgeBase.foundation.phone.confidence).toBeLessThanOrEqual(0.45);
  });

  it("treats the same value from two pages as agreement, not conflict", () => {
    const { knowledgeBase, conflicts } = reconcileClaims([
      evidence("foundation.phone", "512-273-7389", "dom", home),
      evidence("foundation.phone", "512-273-7389", "dom", contact),
    ]);

    expect(conflicts).toHaveLength(0);
    expect(knowledgeBase.foundation.phone.sourceUrls).toHaveLength(2);
  });

  it("breaks a tie inside a tier by page role", () => {
    const { knowledgeBase } = reconcileClaims([
      evidence("foundation.mainAddress", { formatted: "1 Blog St" }, "dom", {
        url: "https://example.com/blog/x",
        role: "blog-post",
      }),
      evidence("foundation.mainAddress", { formatted: "2 Contact Ave" }, "dom", contact),
    ]);

    expect(
      (knowledgeBase.foundation.mainAddress.value as { formatted: string }).formatted,
    ).toBe("2 Contact Ave");
  });
});

describe("collections", () => {
  it("unions string lists and keeps the best-sourced spelling", () => {
    const { knowledgeBase } = reconcileClaims([
      evidence("market.ctas", "Request a Quote", "dom", home),
      evidence("market.ctas", "request a quote", "heuristic", contact),
      evidence("market.ctas", "Call Now", "dom", contact),
    ]);

    expect(knowledgeBase.market.ctas.value).toEqual(["Request a Quote", "Call Now"]);
  });

  it("merges duplicate records and keeps every URL that mentioned them", () => {
    const record = (extra: Record<string, unknown>) => ({
      id: "a",
      method: "scraped",
      confidence: 0.7,
      sourceUrls: [],
      name: "Well Drilling",
      category: null,
      description: null,
      features: [],
      pricing: null,
      url: null,
      sourceCandidateIndexes: [],
      ...extra,
    });

    const { knowledgeBase } = reconcileClaims([
      evidence("offerings", record({}), "dom", home),
      evidence("offerings", record({ description: "We drill wells." }), "json-ld", contact),
    ]);

    const offerings = knowledgeBase.offerings.value!;
    expect(offerings).toHaveLength(1);
    expect(offerings[0].description).toBe("We drill wells.");
    expect(offerings[0].sourceUrls).toHaveLength(2);
  });

  it("keeps a collection-level note when the collection is empty", () => {
    const { knowledgeBase } = reconcileClaims([
      evidence("proof.testimonials", [], "dom", home, {
        confidence: 0,
        note: "Birdeye review widget detected",
      }),
    ]);

    const field = knowledgeBase.proof.testimonials;
    // `[]` with a note is "we looked, found a widget, and could not read it" —
    // a different state from `null`, and the UI says so.
    expect(field.value).toEqual([]);
    expect(field.note).toMatch(/Birdeye/);
  });
});

describe("helpers", () => {
  it("knows which paths are collections", () => {
    expect(isCollectionPath("offerings")).toBe(true);
    expect(isCollectionPath("market.ctas")).toBe(true);
    expect(isCollectionPath("foundation.phone")).toBe(false);
  });

  it("reads a field back by dot path", () => {
    const { knowledgeBase } = reconcileClaims([
      evidence("foundation.phone", "512-273-7389", "dom", home),
    ]);
    const field = fieldAt(knowledgeBase, "foundation.phone") as Sourced<string>;
    expect(field.value).toBe("512-273-7389");
  });
});
