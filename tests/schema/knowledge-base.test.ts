import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  FIELD_META,
  askableFields,
  categoryIdSchema,
  createEmptyKnowledgeBase,
  fieldMeta,
  fieldsInCategory,
  knowledgeBaseSchema,
  needsReview,
  websiteInputSchema,
} from "@/lib/schema";
import { getPath, setPath } from "@/lib/utils/path";

const fixturePath = fileURLToPath(
  new URL("../fixtures/knowledge-base/bee-cave-drilling.json", import.meta.url),
);
const fixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("knowledgeBaseSchema", () => {
  it("validates the hand-written Bee Cave fixture", () => {
    const result = knowledgeBaseSchema.safeParse(fixture);
    // Surface the actual path on failure — a 60-field schema is unpleasant to debug blind.
    expect(result.success ? null : result.error.issues).toBeNull();
  });

  it("accepts a freshly created empty knowledge base", () => {
    const kb = createEmptyKnowledgeBase({ sourceUrl: "https://example.com" });
    expect(knowledgeBaseSchema.safeParse(kb).success).toBe(true);
  });

  it("starts every field in the not-found state rather than absent or empty", () => {
    const kb = createEmptyKnowledgeBase({ sourceUrl: "https://example.com" });
    expect(kb.foundation.yearFounded).toEqual({
      value: null,
      method: "not-found",
      confidence: 0,
      sourceUrls: [],
    });
    expect(kb.people.value).toBeNull();
  });

  it("round-trips through JSON without loss", () => {
    const parsed = knowledgeBaseSchema.parse(fixture);
    const again = knowledgeBaseSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
  });

  it("rejects a fabricated value that skips its provenance", () => {
    const bad = setPath(fixture, "foundation.industry", { value: "Plumbing" });
    expect(knowledgeBaseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a brand colour that is not canonical #rrggbb", () => {
    // ROADMAP §2.3: the reference outputs leak `var(--font-family)` and friends.
    // The schema is the last line of defence against unresolved CSS reaching JSON.
    const bad = setPath(fixture, "branding.colors.value.0.hex", "var(--brand)");
    expect(knowledgeBaseSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps an empty array distinct from a null value", () => {
    const kb = knowledgeBaseSchema.parse(fixture);
    // "We looked and there are none" (with an explanation)…
    expect(kb.proof.aggregateRatings.value).toEqual([]);
    expect(kb.proof.aggregateRatings.note).toContain("JS-rendered");
    // …versus "there is no such thing here at all".
    expect(kb.contentIntelligence.cadence.value).toBeNull();
  });

  it("surfaces the conflicting phone number for review", () => {
    const kb = knowledgeBaseSchema.parse(fixture);
    expect(needsReview(kb.foundation.phone)).toBe(true);
    expect(kb.quality.conflicts[0].path).toBe("foundation.phone");
    expect(kb.quality.conflicts[0].candidates).toHaveLength(2);
  });

  it("flags mock AI prose no matter how confident it claims to be", () => {
    const kb = knowledgeBaseSchema.parse(fixture);
    expect(kb.foundation.overview.method).toBe("ai-mock");
    expect(needsReview(kb.foundation.overview)).toBe(true);
  });
});

describe("websiteInputSchema", () => {
  it.each([
    "example.com",
    "https://example.com",
    "http://sub.example.co.uk/path",
    "  beecavedrilling.com  ",
  ])("accepts %s", (input) => {
    expect(websiteInputSchema.safeParse(input).success).toBe(true);
  });

  it.each(["", "not a url", "localhost", "https://", "example."])(
    "rejects %s",
    (input) => {
      expect(websiteInputSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe("field metadata registry", () => {
  it("has an entry for every category", () => {
    for (const category of CATEGORY_ORDER) {
      expect(fieldsInCategory(category).length).toBeGreaterThan(0);
    }
  });

  it("uses unique paths", () => {
    const paths = FIELD_META.map((meta) => meta.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("only references real categories", () => {
    for (const meta of FIELD_META) {
      expect(categoryIdSchema.safeParse(meta.category).success).toBe(true);
    }
  });

  it("gives every askable field the question text it needs", () => {
    // An askable gap with no wording would render as a bare field name, which is
    // exactly what docs/EDIT-UX.md §7 exists to prevent.
    const missing = askableFields().filter((meta) => !meta.question);
    expect(missing.map((meta) => meta.path)).toEqual([]);
  });

  it("excludes derived and external fields from the ask list", () => {
    for (const path of [
      "branding.writingStyle",
      "branding.artStyle",
      "market.industryOutlook",
      "market.suppliersPartners",
    ]) {
      expect(fieldMeta(path)?.askable).toBe(false);
    }
  });

  it("addresses fields that actually exist in the schema", () => {
    const kb = createEmptyKnowledgeBase({ sourceUrl: "https://example.com" });
    for (const meta of FIELD_META) {
      expect(getPath(kb, meta.path), meta.path).toBeDefined();
    }
  });
});

describe("path utilities", () => {
  it("reads through arrays", () => {
    expect(getPath(fixture, "offerings.value.1.name")).toBe(
      "Pump Installation & Repair",
    );
  });

  it("returns undefined rather than throwing on a missing branch", () => {
    expect(getPath(fixture, "foundation.nope.deeper")).toBeUndefined();
  });

  it("shares untouched branches so memoized record cards stay stable", () => {
    const kb = knowledgeBaseSchema.parse(fixture);
    const edited = setPath(kb, "offerings.value.0.name", "Well Drilling");

    expect(edited.offerings.value?.[0].name).toBe("Well Drilling");
    expect(edited.offerings.value?.[1]).toBe(kb.offerings.value?.[1]);
    expect(edited.branding).toBe(kb.branding);
    // The original is untouched, which is what makes per-field Revert possible.
    expect(kb.offerings.value?.[0].name).toBe("Water Well Drilling");
  });
});
