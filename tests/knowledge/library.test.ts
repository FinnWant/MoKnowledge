import { describe, expect, it } from "vitest";
import { loadCrawlResult } from "../fixtures/load";
import {
  DEFAULT_SORT,
  NO_FILTERS,
  TEMPLATE_CLEARED_PATHS,
  UNKNOWN_INDUSTRY,
  activeFilterChips,
  activeFilterCount,
  completenessBand,
  displayName,
  duplicateAsTemplate,
  filterSummaries,
  industryFacets,
  isViewMode,
  matchesSearch,
  nextSort,
  relativeTime,
  sortSummaries,
  toggle,
  type LibraryFilters,
} from "@/lib/knowledge/library";
import { knowledgeBaseSchema, type KnowledgeBase, type KnowledgeBaseSummary } from "@/lib/schema";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { toSummary } from "@/lib/storage/types";
import { getPath } from "@/lib/utils/path";

/**
 * The library's rules (R11, R12, R14).
 *
 * Two of these are checked against a real scraped knowledge base rather than a
 * hand-written summary: `toSummary` has to pull a location and a set of search
 * keywords out of a document where most fields are null, and a duplicate has to
 * survive the schema. The rest are pure list operations, where a hand-built
 * fixture is the clearer test.
 */

const NOW = new Date("2026-02-13T12:00:00.000Z");

const scraped: KnowledgeBase = buildKnowledgeBase(loadCrawlResult("bee-cave-drilling"), {
  now: new Date("2026-02-13T00:00:00.000Z"),
  enrich: false,
}).knowledgeBase;

function summary(overrides: Partial<KnowledgeBaseSummary> = {}): KnowledgeBaseSummary {
  return {
    id: "id-1",
    version: 1,
    companyName: "Bee Cave Drilling",
    sourceUrl: "https://beecavedrilling.com/",
    industry: "Water well drilling",
    logoUrl: null,
    location: "Dripping Springs, TX",
    completeness: 0.62,
    peopleCount: 8,
    offeringsCount: 14,
    testimonialsCount: 12,
    attentionCount: 3,
    conflictCount: 0,
    keywords: ["Well inspections", "Pump repair", "Nathan Wells"],
    createdAt: "2026-02-10T00:00:00.000Z",
    updatedAt: "2026-02-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("search", () => {
  const record = summary();

  it("matches on the things somebody would actually recall", () => {
    expect(matchesSearch(record, "bee cave")).toBe(true);
    expect(matchesSearch(record, "drilling")).toBe(true);
    expect(matchesSearch(record, "dripping")).toBe(true);
    // Neither of these is in the summary's own fields — they are why `keywords`
    // exists, and why the list route doesn't have to ship fourteen offerings.
    expect(matchesSearch(record, "pump repair")).toBe(true);
    expect(matchesSearch(record, "nathan")).toBe(true);
  });

  it("matches the host, for a record whose name never scraped", () => {
    const nameless = summary({ companyName: null });
    expect(displayName(nameless)).toBe("beecavedrilling.com");
    expect(matchesSearch(nameless, "beecave")).toBe(true);
  });

  it("narrows on a second word rather than widening", () => {
    expect(matchesSearch(record, "bee plumbing")).toBe(false);
  });

  it("matches partial words, because people half-remember names", () => {
    expect(matchesSearch(record, "dril")).toBe(true);
  });

  it("treats an empty search as no filter at all", () => {
    expect(matchesSearch(record, "   ")).toBe(true);
  });
});

describe("filters", () => {
  const records = [
    summary({ id: "a", completeness: 0.2, attentionCount: 0, conflictCount: 0, testimonialsCount: 0 }),
    summary({ id: "b", completeness: 0.55, industry: "Accounting", attentionCount: 4 }),
    summary({ id: "c", completeness: 0.9, industry: null, conflictCount: 2, peopleCount: 0 }),
  ];

  function ids(filters: Partial<LibraryFilters>): string[] {
    return filterSummaries(records, { ...NO_FILTERS, ...filters }, NOW).map((row) => row.id);
  }

  it("bands completeness on the documented boundaries", () => {
    expect(completenessBand(0.39)).toBe("low");
    expect(completenessBand(0.4)).toBe("medium");
    expect(completenessBand(0.7)).toBe("medium");
    expect(completenessBand(0.71)).toBe("high");
  });

  it("widens within a group and narrows across groups", () => {
    expect(ids({ completeness: ["low"] })).toEqual(["a"]);
    expect(ids({ completeness: ["low", "high"] })).toEqual(["a", "c"]);
    // Two groups: low completeness AND accounting matches nothing.
    expect(ids({ completeness: ["low"], industries: ["Accounting"] })).toEqual([]);
  });

  it("separates unreviewed fields from conflicts", () => {
    expect(ids({ review: ["attention"] })).toEqual(["b", "c"]);
    expect(ids({ review: ["conflicts"] })).toEqual(["c"]);
  });

  it("filters on what a record holds", () => {
    expect(ids({ content: ["testimonials"] })).toEqual(["b", "c"]);
    expect(ids({ content: ["people"] })).toEqual(["a", "b"]);
  });

  it("filters on when a record was last touched", () => {
    const stale = summary({ id: "old", updatedAt: "2025-11-01T00:00:00.000Z" });
    const fresh = filterSummaries([...records, stale], { ...NO_FILTERS, withinDays: 7 }, NOW);
    expect(fresh.map((row) => row.id)).not.toContain("old");
  });

  it("gives records with no industry a bucket instead of dropping them", () => {
    const facets = industryFacets(records);
    expect(facets.map((facet) => facet.value)).toContain(UNKNOWN_INDUSTRY);
    expect(ids({ industries: [UNKNOWN_INDUSTRY] })).toEqual(["c"]);
  });

  it("counts industries from the loaded set, commonest first", () => {
    const facets = industryFacets([...records, summary({ id: "d", industry: "Accounting" })]);
    expect(facets[0]).toEqual({ value: "Accounting", count: 2 });
  });
});

describe("filter chips", () => {
  const filters: LibraryFilters = {
    search: "drilling",
    industries: ["Accounting", "Water well drilling"],
    completeness: ["low"],
    review: ["conflicts"],
    content: [],
    withinDays: 30,
  };

  it("counts every active filter, search included", () => {
    expect(activeFilterCount(filters)).toBe(6);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("hands back the filters that survive removing one", () => {
    const chips = activeFilterChips(filters);
    const industry = chips.find((chip) => chip.key === "industry:Accounting");

    expect(industry?.without.industries).toEqual(["Water well drilling"]);
    // Removing one chip leaves every other group untouched.
    expect(industry?.without.completeness).toEqual(["low"]);
    expect(industry?.without.search).toBe("drilling");
  });

  it("toggles a value in and back out of a group", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sorting", () => {
  const records = [
    summary({ id: "b", companyName: "Beta", completeness: 0.5, updatedAt: "2026-02-11T00:00:00.000Z" }),
    summary({ id: "a", companyName: "Alpha", completeness: 0.9, updatedAt: "2026-02-12T00:00:00.000Z" }),
    summary({ id: "c", companyName: "Gamma", completeness: 0.5, updatedAt: "2026-02-10T00:00:00.000Z" }),
  ];

  it("defaults to what was touched most recently", () => {
    expect(sortSummaries(records, DEFAULT_SORT).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts ascending by completeness for the 'what needs work' view", () => {
    const sorted = sortSummaries(records, { key: "completeness", direction: "asc" });
    expect(sorted.map((row) => row.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by name, so equal rows keep a stable order", () => {
    const sorted = sortSummaries(records, { key: "completeness", direction: "desc" });
    // Beta and Gamma both score 0.5; the tiebreak is alphabetical either way.
    expect(sorted.map((row) => row.companyName)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("starts counts descending and names ascending, then reverses", () => {
    expect(nextSort(DEFAULT_SORT, "offerings")).toEqual({ key: "offerings", direction: "desc" });
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
  });
});

describe("relative time", () => {
  it("reads as a sentence rather than a timestamp", () => {
    expect(relativeTime("2026-02-13T11:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-02-13T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-02-13T10:00:00.000Z", NOW)).toBe("2h ago");
    expect(relativeTime("2026-02-12T10:00:00.000Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-01-13T12:00:00.000Z", NOW)).toBe("1mo ago");
  });

  it("never reports a clock skew as the future", () => {
    expect(relativeTime("2026-02-13T12:05:00.000Z", NOW)).toBe("just now");
    expect(relativeTime("not a date", NOW)).toBe("unknown");
  });
});

describe("view modes", () => {
  it("only accepts the two that exist", () => {
    expect(isViewMode("table")).toBe(true);
    expect(isViewMode("detail")).toBe(false);
    expect(isViewMode(null)).toBe(false);
  });
});

describe("toSummary", () => {
  const built = toSummary(scraped);

  it("prefers the city and region over the whole postal address", () => {
    // Whatever the fixture holds, a card must never be handed a street address.
    if (scraped.foundation.mainAddress.value?.city) {
      expect(built.location).not.toContain(scraped.foundation.mainAddress.value.formatted);
    }
    expect(built.location === null || built.location.length < 60).toBe(true);
  });

  it("carries search terms the summary's own fields don't hold", () => {
    const offerings = scraped.offerings.value ?? [];
    if (offerings.length > 0) {
      expect(built.keywords).toContain(offerings[0].name);
    }
    // Bounded: a record with forty offerings must not ship forty keywords.
    expect(built.keywords.length).toBeLessThanOrEqual(60);
  });

  it("counts fields needing review, not just conflicts", () => {
    expect(built.attentionCount).toBeGreaterThanOrEqual(built.conflictCount);
  });

  it("stays a summary — no category ever rides along", () => {
    expect(Object.keys(built)).not.toContain("foundation");
    expect(Object.keys(built)).not.toContain("offerings");
  });
});

describe("duplicateAsTemplate", () => {
  const copy = duplicateAsTemplate(scraped, {
    id: "template-1",
    now: new Date("2026-03-01T00:00:00.000Z"),
  });

  it("produces something the store will accept", () => {
    expect(knowledgeBaseSchema.safeParse(copy).success).toBe(true);
    expect(copy.id).toBe("template-1");
    expect(copy.version).toBe(1);
  });

  it("clears what belongs to the original company", () => {
    for (const path of TEMPLATE_CLEARED_PATHS) {
      const field = getPath(copy, path) as { value: unknown } | undefined;
      expect(field?.value ?? null).toBeNull();
    }
  });

  it("keeps the structure the template exists for", () => {
    expect(copy.foundation.industry.value).toBe(scraped.foundation.industry.value);
    expect(copy.offerings.value).toEqual(scraped.offerings.value);
    expect(copy.branding.colors.value).toEqual(scraped.branding.colors.value);
  });

  it("keeps a findable name rather than an empty one", () => {
    expect(copy.companyName.value).toContain("template");
    expect(copy.companyName.method).toBe("user-edited");
  });

  it("re-scores, rather than inheriting the original's completeness", () => {
    expect(copy.quality.overallScore).toBeLessThan(scraped.quality.overallScore);
    expect(copy.quality.conflicts).toEqual([]);
  });

  it("does not claim the original's crawl", () => {
    expect(copy.scrape.pages).toEqual([]);
  });
});
