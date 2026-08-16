import { newId, type Cadence, type ContentItem, type Offering } from "@/lib/schema";

/**
 * Derived content intelligence: cadence, headline patterns, and content gaps.
 *
 * `contentGaps` is the highest-value field in the category and the one that best
 * expresses the brief's "do as much for them as possible" — instead of telling a
 * customer what they have, it tells them what to write next.
 */

/** A blog untouched for this long is a MoBlogs sales trigger. */
const STALE_DAYS = 90;

export function computeCadence(posts: ContentItem[], now = new Date()): Cadence | null {
  const dates = posts
    .map((post) => post.publishedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) {
    // Posts with no dates still tell us something, but not cadence. Saying so
    // beats inventing a rate from nothing.
    return posts.length > 0
      ? {
          postsPerMonth: null,
          firstPublished: null,
          lastPublished: null,
          daysSinceLast: null,
          isStale: false,
        }
      : null;
  }

  const first = dates[0];
  const last = dates.at(-1)!;
  const spanMonths = Math.max(
    1,
    (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );
  const daysSinceLast = Math.floor(
    (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    postsPerMonth: Number((dates.length / spanMonths).toFixed(2)),
    firstPublished: first.toISOString().slice(0, 10),
    lastPublished: last.toISOString().slice(0, 10),
    daysSinceLast: Math.max(0, daysSinceLast),
    isStale: daysSinceLast > STALE_DAYS,
  };
}

/* ------------------------------------------------------- headline patterns */

type PatternName =
  | "how-to"
  | "listicle"
  | "question"
  | "comparison"
  | "local-service"
  | "seasonal"
  | "announcement"
  | "other";

const PATTERNS: Array<[PatternName, RegExp]> = [
  ["how-to", /^(how to|how do|a guide to|guide to|the ultimate guide|steps to|ways to)\b/i],
  ["listicle", /^\d+\s+\w+|\btop\s+\d+\b|\b\d+\s+(?:ways|tips|reasons|things|signs|mistakes)\b/i],
  ["question", /\?\s*$/],
  ["comparison", /\bvs\.?\b|\bversus\b|\bcompared to\b|\bwhich is better\b/i],
  ["seasonal", /\b(spring|summer|fall|autumn|winter|holiday|christmas|new year)\b/i],
  ["announcement", /\b(announcing|introducing|now offering|we[' ]re excited|new at|welcome)\b/i],
  ["local-service", /\bin\s+[A-Z][a-z]+(?:,\s*[A-Z]{2})?\s*$|\bnear (me|you)\b/],
];

export function detectHeadlinePatterns(posts: ContentItem[]) {
  const buckets = new Map<PatternName, string[]>();

  for (const post of posts) {
    const title = post.title.trim();
    if (!title) continue;

    const match = PATTERNS.find(([, pattern]) => pattern.test(title));
    const name: PatternName = match ? match[0] : "other";
    const bucket = buckets.get(name) ?? [];
    bucket.push(title);
    buckets.set(name, bucket);
  }

  return [...buckets.entries()]
    .filter(([name, titles]) => name !== "other" || titles.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pattern, titles]) => ({
      id: newId(),
      method: "derived" as const,
      confidence: 0.7,
      sourceUrls: [],
      pattern,
      count: titles.length,
      examples: titles.slice(0, 3),
    }));
}

/* ------------------------------------------------------------ content gaps */

type GapInput = {
  offerings: Offering[];
  posts: ContentItem[];
  /** URLs of every page crawled, for checking whether an offering has a page. */
  pageUrls: string[];
};

/**
 * An offering with no supporting page or post is a content gap.
 *
 * The check is deliberately conservative — a gap the customer disputes is worse
 * than a gap we missed, because the whole field is a recommendation about where
 * to spend their time.
 */
export function findContentGaps({ offerings, posts, pageUrls }: GapInput) {
  const haystack = [
    ...posts.map((post) => `${post.title} ${post.excerpt ?? ""}`),
    ...pageUrls,
  ]
    .join(" ")
    .toLowerCase();

  const gaps: Array<{
    id: string;
    method: "derived";
    confidence: number;
    sourceUrls: string[];
    topic: string;
    reason: string;
    relatedOffering: string | null;
  }> = [];

  for (const offering of offerings) {
    const terms = significantTerms(offering.name);
    if (terms.length === 0) continue;

    // Covered if every distinctive word in the name appears somewhere in the
    // site's content or URLs.
    const covered = terms.every((term) => haystack.includes(term));
    if (covered) continue;

    gaps.push({
      id: newId(),
      method: "derived",
      confidence: 0.6,
      sourceUrls: [],
      topic: offering.name,
      reason: posts.length === 0
        ? "Listed as an offering, but the site has no articles at all"
        : "Listed as an offering but has no dedicated page or article",
      relatedOffering: offering.id,
    });
    if (gaps.length >= 10) break;
  }

  return gaps;
}

const GAP_STOPWORDS = new Set([
  "and","or","the","for","of","in","a","an","to","with","services","service","solutions",
  "solution","systems","system","products","product","our","your",
]);

function significantTerms(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !GAP_STOPWORDS.has(word))
    .slice(0, 3);
}

/* ------------------------------------------------------------------ taxonomy */

export function buildTaxonomy(posts: ContentItem[]) {
  const categories = new Set<string>();
  for (const post of posts) {
    if (post.category) categories.add(post.category);
  }
  if (categories.size === 0) return null;
  return { categories: [...categories].slice(0, 30), tags: [] };
}
