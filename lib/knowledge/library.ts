import { notFound, userEdited, type KnowledgeBase, type KnowledgeBaseSummary } from "@/lib/schema";
import { buildQuality } from "@/lib/scraper/analyzers/completeness";
import { getPath, setPath } from "@/lib/utils/path";
import { hostOf } from "./display";

/**
 * The library's rules — search, filters, sorting — as pure functions.
 *
 * All of it runs client-side over the loaded summaries, which is the scale
 * assumption docs/VIEW-PAGE.md states outright: a local JSON store holds tens of
 * records, not thousands, and filtering in memory is what keeps search instant.
 * Past a few hundred this moves behind the storage adapter, which is the point
 * the Supabase design earns its place.
 *
 * Keeping it out of the components is the same call as `display.ts`: a filter
 * that silently drops a record is a real bug and an invisible one, and this file
 * can be tested against a list of summaries without a browser.
 */

/* ------------------------------------------------------------------ modes */

export type ViewMode = "card" | "table";

export const VIEW_MODES: readonly ViewMode[] = ["card", "table"];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (VIEW_MODES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- filters */

/** Under 40% · 40–70% · over 70% — the bands from docs/VIEW-PAGE.md. */
export type CompletenessBand = "low" | "medium" | "high";

/** "Has unreviewed fields" and "has conflicts" are different questions. */
export type ReviewFilter = "attention" | "conflicts";

export type ContentFilter = "testimonials" | "offerings" | "people";

export type LibraryFilters = {
  search: string;
  industries: string[];
  completeness: CompletenessBand[];
  review: ReviewFilter[];
  content: ContentFilter[];
  /** Updated within this many days. */
  withinDays: number | null;
};

export const NO_FILTERS: LibraryFilters = {
  search: "",
  industries: [],
  completeness: [],
  review: [],
  content: [],
  withinDays: null,
};

export const COMPLETENESS_LABELS: Record<CompletenessBand, string> = {
  low: "Under 40%",
  medium: "40–70%",
  high: "Over 70%",
};

export const REVIEW_LABELS: Record<ReviewFilter, string> = {
  attention: "Needs review",
  conflicts: "Has conflicts",
};

export const CONTENT_LABELS: Record<ContentFilter, string> = {
  testimonials: "Has testimonials",
  offerings: "Has offerings",
  people: "Has people",
};

export const DATE_WINDOWS: readonly number[] = [7, 30, 90];

export function completenessBand(value: number): CompletenessBand {
  if (value < 0.4) return "low";
  if (value <= 0.7) return "medium";
  return "high";
}

/**
 * Search across the things somebody would actually recall about a record — the
 * company, its industry, where it works, what it sells, who works there. The
 * summary carries `keywords` precisely so this can match an offering name
 * without the list route shipping the offerings.
 *
 * Every token must match, so a second word narrows rather than widens. Matching
 * is on substrings, not whole words: "drill" finds "Drilling", and a user who
 * half-remembers a name should not have to remember all of it.
 */
export function searchHaystack(summary: KnowledgeBaseSummary): string {
  return [
    summary.companyName,
    summary.industry,
    summary.location,
    hostOf(summary.sourceUrl),
    ...summary.keywords,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(summary: KnowledgeBaseSummary, search: string): boolean {
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = searchHaystack(summary);
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Filters combine with AND across groups and OR within a group: picking two
 * industries widens, adding a completeness band narrows. Anything else surprises
 * people — two industry chips that produced nothing would look broken.
 */
export function filterSummaries(
  summaries: KnowledgeBaseSummary[],
  filters: LibraryFilters,
  now: Date = new Date(),
): KnowledgeBaseSummary[] {
  return summaries.filter((summary) => {
    if (!matchesSearch(summary, filters.search)) return false;

    if (
      filters.industries.length > 0 &&
      !filters.industries.includes(summary.industry ?? UNKNOWN_INDUSTRY)
    ) {
      return false;
    }

    if (
      filters.completeness.length > 0 &&
      !filters.completeness.includes(completenessBand(summary.completeness))
    ) {
      return false;
    }

    if (filters.review.length > 0) {
      const matches = filters.review.some((flag) =>
        flag === "conflicts" ? summary.conflictCount > 0 : summary.attentionCount > 0,
      );
      if (!matches) return false;
    }

    if (filters.content.length > 0) {
      const matches = filters.content.some((flag) => contentCount(summary, flag) > 0);
      if (!matches) return false;
    }

    if (filters.withinDays !== null && daysSince(summary.updatedAt, now) > filters.withinDays) {
      return false;
    }

    return true;
  });
}

function contentCount(summary: KnowledgeBaseSummary, flag: ContentFilter): number {
  if (flag === "testimonials") return summary.testimonialsCount;
  if (flag === "offerings") return summary.offeringsCount;
  return summary.peopleCount;
}

export const UNKNOWN_INDUSTRY = "Industry not found";

/**
 * Industry options come from the loaded set rather than a fixed list, so the
 * filter can never offer a value that matches nothing. Records with no industry
 * get their own bucket instead of disappearing from the filter entirely — "which
 * ones are we missing an industry for" is a question worth being able to ask.
 */
export function industryFacets(
  summaries: KnowledgeBaseSummary[],
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    const key = summary.industry ?? UNKNOWN_INDUSTRY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function activeFilterCount(filters: LibraryFilters): number {
  return (
    filters.industries.length +
    filters.completeness.length +
    filters.review.length +
    filters.content.length +
    (filters.withinDays === null ? 0 : 1) +
    (filters.search.trim().length > 0 ? 1 : 0)
  );
}

/**
 * The removable chips above the results. Each one carries the filters it leaves
 * behind, so the chip row is rendered from state rather than from a switch in
 * the component — adding a filter group means adding it here and nowhere else.
 */
export type FilterChip = { key: string; label: string; without: LibraryFilters };

export function activeFilterChips(filters: LibraryFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.search.trim().length > 0) {
    chips.push({
      key: "search",
      label: `“${filters.search.trim()}”`,
      without: { ...filters, search: "" },
    });
  }

  for (const industry of filters.industries) {
    chips.push({
      key: `industry:${industry}`,
      label: industry,
      without: { ...filters, industries: without(filters.industries, industry) },
    });
  }

  for (const band of filters.completeness) {
    chips.push({
      key: `completeness:${band}`,
      label: COMPLETENESS_LABELS[band],
      without: { ...filters, completeness: without(filters.completeness, band) },
    });
  }

  for (const flag of filters.review) {
    chips.push({
      key: `review:${flag}`,
      label: REVIEW_LABELS[flag],
      without: { ...filters, review: without(filters.review, flag) },
    });
  }

  for (const flag of filters.content) {
    chips.push({
      key: `content:${flag}`,
      label: CONTENT_LABELS[flag],
      without: { ...filters, content: without(filters.content, flag) },
    });
  }

  if (filters.withinDays !== null) {
    chips.push({
      key: "within",
      label: `Updated in ${filters.withinDays} days`,
      without: { ...filters, withinDays: null },
    });
  }

  return chips;
}

/** Adds or removes a value from a multi-select filter group. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? without(values, value) : [...values, value];
}

function without<T>(values: T[], value: T): T[] {
  return values.filter((entry) => entry !== value);
}

/* ---------------------------------------------------------------- sorting */

export type SortKey =
  | "updated"
  | "created"
  | "name"
  | "completeness"
  | "offerings"
  | "people"
  | "proof";

export type SortDirection = "asc" | "desc";

export type Sort = { key: SortKey; direction: SortDirection };

/** "What did I just do" — the order the store already returns. */
export const DEFAULT_SORT: Sort = { key: "updated", direction: "desc" };

export function sortSummaries(
  summaries: KnowledgeBaseSummary[],
  sort: Sort,
): KnowledgeBaseSummary[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  return [...summaries].sort((a, b) => {
    const compared = compare(a, b, sort.key);
    // Name breaks every tie, so two records with the same completeness keep a
    // stable order between renders rather than swapping as the list re-sorts.
    return compared !== 0 ? compared * sign : displayName(a).localeCompare(displayName(b));
  });
}

function compare(a: KnowledgeBaseSummary, b: KnowledgeBaseSummary, key: SortKey): number {
  switch (key) {
    case "name":
      return displayName(a).localeCompare(displayName(b));
    case "completeness":
      return a.completeness - b.completeness;
    case "offerings":
      return a.offeringsCount - b.offeringsCount;
    case "people":
      return a.peopleCount - b.peopleCount;
    case "proof":
      return a.testimonialsCount - b.testimonialsCount;
    case "created":
      return a.createdAt.localeCompare(b.createdAt);
    default:
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}

/**
 * Clicking a column sorts descending first for counts and dates — "most" and
 * "newest" are what someone means by sorting on them — and ascending for names.
 * Clicking the active column reverses it.
 */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: key === "name" ? "asc" : "desc" };
}

/* --------------------------------------------------------------- labelling */

/** A record with no scraped name is still findable by the site it came from. */
export function displayName(summary: KnowledgeBaseSummary): string {
  const name = summary.companyName?.trim();
  return name && name.length > 0 ? name : hostOf(summary.sourceUrl);
}

export function daysSince(timestamp: string, now: Date): number {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/**
 * "2 hours ago". Deliberately coarse: the exact minute a knowledge base was
 * saved is never the question, and a relative time that reads like a sentence is
 * easier to scan down a column than a timestamp.
 */
export function relativeTime(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 0) return "just now"; // A clock skew is not worth a "in 3 minutes".
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/* -------------------------------------------------------------- duplicate */

/**
 * Fields cleared by `Duplicate as template` (R14).
 *
 * The split is "would this be wrong for the second location" — a franchise
 * shares its industry, its services, its voice and its palette, and shares none
 * of its address, its phone number, its team or its reviews. Anything not listed
 * here is kept deliberately: the value of a template is what survives it.
 */
export const TEMPLATE_CLEARED_PATHS: readonly string[] = [
  "foundation.overview",
  "foundation.website",
  "foundation.yearFounded",
  "foundation.legalEntityType",
  "foundation.employeeCount",
  "foundation.revenue",
  "foundation.mainAddress",
  "foundation.otherLocations",
  "foundation.serviceLocations",
  "foundation.altNames",
  "foundation.phone",
  "foundation.email",
  "positioning.foundingStory",
  "onlinePresence.profiles",
  "people",
  "proof.testimonials",
  "proof.aggregateRatings",
  "proof.caseStudies",
  "proof.certifications",
  "proof.memberships",
  "proof.awards",
  "proof.pressMentions",
  "proof.trustStats",
  "proof.clientLogos",
  "contentIntelligence.posts",
  "contentIntelligence.cadence",
  "contentIntelligence.taxonomy",
  "contentIntelligence.headlinePatterns",
];

/**
 * A copy with the company-specific fields emptied, keeping the structure and
 * the industry defaults. Useful for franchises and multi-location businesses,
 * which the reference set shows are a real MoFlo segment.
 *
 * The name is kept and marked rather than cleared: a nameless record in the
 * library is one nobody can find again, and the first thing the user does with a
 * template is rename it anyway.
 */
export function duplicateAsTemplate(
  knowledgeBase: KnowledgeBase,
  options: { id: string; now?: Date },
): KnowledgeBase {
  const now = (options.now ?? new Date()).toISOString();

  let copy: KnowledgeBase = { ...knowledgeBase };
  for (const path of TEMPLATE_CLEARED_PATHS) {
    if (getPath(copy, path) === undefined) continue;
    copy = setPath(copy, path, notFound("Cleared when this template was created."));
  }

  const name = knowledgeBase.companyName.value;
  copy = {
    ...copy,
    id: options.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    companyName: userEdited(
      name ? `${name} (template)` : "Untitled template",
      knowledgeBase.companyName,
    ),
    // The scrape it came from belongs to the original. Keeping the page list
    // would have the template claiming provenance it does not have.
    scrape: { ...knowledgeBase.scrape, pages: [], warnings: [] },
  };

  // Conflicts were about values that are no longer here; the score has to be
  // recomputed or the template inherits the original's completeness.
  return { ...copy, quality: buildQuality(copy, []) };
}
