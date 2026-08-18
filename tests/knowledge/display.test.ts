import { describe, expect, it } from "vitest";
import { loadCrawlResult } from "../fixtures/load";
import {
  categorySummary,
  categoryView,
  chipValues,
  displayKind,
  enumLabel,
  fieldCount,
  formatDuration,
  formatScalar,
  hostOf,
  pageLabel,
  presentColors,
  presentComposite,
  presentRecords,
  recordNeedsReview,
  reviewFlag,
  sourceSummary,
} from "@/lib/knowledge/display";
import {
  CATEGORY_ORDER,
  fieldMeta,
  fieldsInCategory,
  type FieldMeta,
  type KnowledgeBase,
  type Sourced,
} from "@/lib/schema";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { getPath } from "@/lib/utils/path";

/**
 * The read-only display layer, checked against a real scrape rather than a
 * hand-built object — a presenter that silently drops an offering's price or
 * renders `[object Object]` is exactly the bug a fixture written to match the
 * presenter would hide.
 */

const CLOCK = new Date("2026-02-13T00:00:00.000Z");
const kb: KnowledgeBase = buildKnowledgeBase(loadCrawlResult("bee-cave-drilling"), {
  now: CLOCK,
  enrich: false,
}).knowledgeBase;

function meta(path: string): FieldMeta {
  const found = fieldMeta(path);
  if (!found) throw new Error(`no field meta for ${path}`);
  return found;
}

describe("categoryView", () => {
  it("accounts for every field in the category, once", () => {
    for (const category of CATEGORY_ORDER) {
      const view = categoryView(kb, category);
      expect(view.filled.length + view.missing.length).toBe(
        fieldsInCategory(category).length,
      );
    }
  });

  it("puts values in `filled` and gaps in `missing`", () => {
    const view = categoryView(kb, "foundation");
    const filled = view.filled.map((entry) => entry.meta.path);

    expect(filled).toContain("companyName");
    expect(filled).toContain("foundation.website");
    // The reference profile has no revenue for this company either — a gap we
    // report rather than invent.
    expect(view.missing.map((entry) => entry.meta.path)).toContain(
      "foundation.revenue",
    );
  });

  it("summarises a one-collection category by its records, not its fields", () => {
    // "1 of 1 found" is true of a category holding thirty people, and useless.
    expect(categorySummary(categoryView(kb, "people"))).toBe(
      `${(kb.people.value ?? []).length} key people`,
    );

    const foundation = categoryView(kb, "foundation");
    expect(categorySummary(foundation)).toBe(
      `${foundation.filled.length} of ${foundation.filled.length + foundation.missing.length} found`,
    );
  });

  it("counts attention items", () => {
    const view = categoryView(kb, "foundation");
    expect(view.attentionCount).toBe(
      view.filled.filter((entry) => entry.attention).length,
    );
  });
});

describe("record presenters", () => {
  it("gives every person a title and keeps their provenance", () => {
    const people = presentRecords("people", kb.people.value);
    expect(people.length).toBeGreaterThan(0);

    for (const person of people) {
      expect(person.title.trim().length).toBeGreaterThan(0);
      expect(person.provenance?.method).toBeTruthy();
      expect(person.key).toBe(person.provenance?.id);
    }
  });

  it("keeps an offering's price and description", () => {
    const offerings = presentRecords("offerings", kb.offerings.value);
    expect(offerings.length).toBeGreaterThan(0);

    const priced = (kb.offerings.value ?? []).filter((item) => item.pricing);
    for (const offering of priced) {
      const rendered = offerings.find((entry) => entry.title === offering.name);
      expect(rendered?.details.map((detail) => detail.value)).toContain(
        offering.pricing,
      );
    }
  });

  it("never renders an object as a string", () => {
    for (const path of ["people", "offerings", "proof.testimonials"]) {
      for (const record of presentRecords(path, getPathValue(kb, path))) {
        const text = [
          record.title,
          record.subtitle,
          record.body,
          ...record.tags,
          ...record.details.map((detail) => detail.value),
        ].join(" ");
        expect(text).not.toContain("[object Object]");
        expect(text).not.toContain("undefined");
      }
    }
  });

  it("quotes a testimonial and attributes it", () => {
    const [first] = presentRecords("proof.testimonials", [
      {
        id: "t1",
        method: "scraped" as const,
        confidence: 0.9,
        sourceUrls: ["https://example.com/reviews"],
        quote: "They fixed our pump the same day.",
        authorName: "Dana R.",
        authorRole: null,
        authorCompany: null,
        authorLocation: "Austin, TX",
        rating: 5,
        date: null,
        platform: "google-business",
        mediaUrl: null,
        topics: ["pump repair"],
        mentionsPeople: [],
        mentionsOfferings: [],
      },
    ]);

    expect(first.title).toBe("Dana R.");
    expect(first.subtitle).toBe("Austin, TX");
    expect(first.body).toContain("They fixed our pump the same day.");
    expect(first.tags).toEqual(["Google Business Profile", "5 out of 5"]);
  });

  it("falls back to a readable card for a shape it has no presenter for", () => {
    const [record] = presentRecords("some.future.collection", [
      { name: "Unknown thing", description: "Still renders." },
    ]);

    expect(record.title).toBe("Unknown thing");
    expect(record.body).toBe("Still renders.");
    expect(record.key).toBe("some.future.collection-0");
  });

  it("handles records without provenance", () => {
    const [record] = presentRecords("foundation.otherLocations", [
      {
        formatted: "1 Main St, Austin, TX",
        street: "1 Main St",
        city: "Austin",
        region: "TX",
        postalCode: null,
        country: null,
      },
    ]);

    expect(record.provenance).toBeNull();
    expect(record.title).toBe("1 Main St, Austin, TX");
    expect(recordNeedsReview(record.provenance)).toBe(false);
  });
});

describe("scalars and chips", () => {
  it("renders a year without a thousands separator", () => {
    expect(formatScalar(meta("foundation.yearFounded"), 1980)).toBe("1980");
    expect(formatScalar(meta("foundation.employeeCount"), 1200)).toBe("1,200");
  });

  it("humanises enum values", () => {
    expect(formatScalar(meta("foundation.businessModel"), "b2c")).toBe(
      "Consumers (B2C)",
    );
    expect(formatScalar(meta("foundation.companyRole"), "service-provider")).toBe(
      "Service provider",
    );
    expect(enumLabel("industry-solution")).toBe("Industry solution");
  });

  it("returns null for an empty value rather than an empty element", () => {
    expect(formatScalar(meta("foundation.industry"), "   ")).toBeNull();
    expect(formatScalar(meta("foundation.industry"), null)).toBeNull();
  });

  it("reads theme records as chips", () => {
    const themes = chipValues(
      "contentIntelligence.themes",
      kb.contentIntelligence.themes.value,
    );
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.every((theme) => typeof theme === "string")).toBe(true);
  });
});

describe("colors", () => {
  it("reports each colour's share of the palette", () => {
    const colors = presentColors(kb.branding.colors.value);
    expect(colors.length).toBeGreaterThan(0);

    const total = colors.reduce((sum, color) => sum + color.share, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color.hex))).toBe(true);
  });

  it("survives a palette with no frequencies", () => {
    const colors = presentColors([
      { id: "c1", method: "derived", confidence: 0.6, sourceUrls: [], hex: "#112233", role: "primary", frequency: 0 },
    ]);
    expect(colors[0].share).toBe(0);
  });
});

describe("composites", () => {
  it("flattens an address, skipping the parts that are null", () => {
    const rows = presentComposite("foundation.mainAddress", {
      formatted: "13341 Hwy 71 W, Bee Cave, TX 78738",
      street: null,
      city: "Bee Cave",
      region: "TX",
      postalCode: null,
      country: null,
    });

    expect(rows.map((row) => row.label)).toEqual(["Address", "City", "Region"]);
  });

  it("explains a stale blog in words", () => {
    const rows = presentComposite("contentIntelligence.cadence", {
      postsPerMonth: 1.5,
      firstPublished: "2021-01-04",
      lastPublished: "2024-02-02",
      daysSinceLast: 742,
      isStale: true,
    });

    expect(rows.find((row) => row.label === "How often they publish")?.value).toBe(
      "1.5 posts a month",
    );
    expect(rows.find((row) => row.label === "Last published")?.value).toContain(
      "gone quiet",
    );
  });
});

describe("review flags", () => {
  const field = (patch: Partial<Sourced<string>>): Sourced<string> => ({
    value: "something",
    method: "scraped",
    confidence: 0.9,
    sourceUrls: [],
    ...patch,
  });

  it("says nothing about a confidently scraped value", () => {
    expect(reviewFlag(field({}))).toBeNull();
  });

  it("surfaces a reconciler note verbatim", () => {
    const flag = reviewFlag(field({ note: "We found 2 different phone numbers." }));
    expect(flag?.detail).toBe("We found 2 different phone numbers.");
  });

  it("flags a low-confidence value without showing the number", () => {
    const flag = reviewFlag(field({ confidence: 0.3 }));
    expect(flag?.label).toBe("Not fully sure");
    expect(`${flag?.label} ${flag?.detail}`).not.toMatch(/0\.\d/);
  });

  it("leaves AI fields to their provenance badge", () => {
    expect(reviewFlag(field({ method: "ai-mock", confidence: 0.5 }))).toBeNull();
    expect(reviewFlag(field({ method: "ai-live", confidence: 0.5 }))).toBeNull();
  });
});

describe("labels", () => {
  it("names pages the way their owner would", () => {
    expect(pageLabel("https://example.com")).toBe("the home page");
    expect(pageLabel("https://example.com/")).toBe("the home page");
    expect(pageLabel("https://example.com/contact-us")).toBe("the Contact us page");
    expect(pageLabel("https://example.com/about/team/")).toBe("the Team page");
    expect(pageLabel("not a url")).toBe("not a url");
  });

  it("summarises sources without listing twenty URLs", () => {
    expect(sourceSummary([])).toBeNull();
    expect(sourceSummary(["https://example.com/about"])).toBe(
      "Found on the About page.",
    );
    expect(
      sourceSummary(["https://example.com/about", "https://example.com/contact"]),
    ).toBe("Found on the About page and the Contact page.");
    expect(
      sourceSummary([
        "https://example.com/about",
        "https://example.com/contact",
        "https://example.com/team",
      ]),
    ).toBe("Found on the About page and 2 other pages.");
  });

  it("keeps display kinds aligned with what the value actually is", () => {
    expect(displayKind(meta("branding.logos"))).toBe("media");
    expect(displayKind(meta("contentIntelligence.themes"))).toBe("chips");
    expect(displayKind(meta("foundation.otherLocations"))).toBe("records");
    expect(displayKind(meta("foundation.yearFounded"))).toBe("text");
    expect(displayKind(meta("foundation.overview"))).toBe("prose");
  });

  it("formats the scrape stats", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(24_600)).toBe("25s");
    expect(formatDuration(95_000)).toBe("1m 35s");
    expect(hostOf("https://www.beecavedrilling.com/about")).toBe(
      "beecavedrilling.com",
    );
  });

  it("counts records in a collection field", () => {
    expect(fieldCount(kb.people)).toBe((kb.people.value ?? []).length);
    expect(fieldCount(kb.companyName)).toBeNull();
  });
});

function getPathValue(source: KnowledgeBase, path: string): unknown {
  return (getPath(source, path) as Sourced<unknown> | undefined)?.value ?? [];
}
