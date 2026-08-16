import type { KnowledgeBase } from "@/lib/schema";
import type { GoldenProfile } from "./schema";

/**
 * Scores a produced knowledge base against a transcribed reference profile.
 *
 * The methodology is docs/VALIDATION.md §3, and the framing there matters: the
 * reference is a **peer output, not ground truth**. A field we produce that the
 * reference lacks lowers precision without being wrong, which is why every field
 * reports matched/expected/produced rather than a single number — a reviewer can
 * see whether a low score means we missed something or found more.
 *
 * Comparison is fuzzy on purpose. "Water Well Drilling" and "Well Drilling" are
 * the same offering, and an exact-match harness would report a scraper that
 * works as a scraper that fails.
 */

export type FieldScore = {
  field: string;
  matched: number;
  expected: number;
  produced: number;
};

export type SiteScore = {
  slug: string;
  fields: FieldScore[];
  matched: number;
  expected: number;
  produced: number;
};

/**
 * Fields the reference fills by reading the site with a model, and that our
 * pipeline fills the same way (`prompts/01-company-profile.md`).
 *
 * `npm run validate` runs extraction only — no key, no model, reproducible — so
 * these score at or near zero there by construction. Flagging them keeps the
 * report honest in both directions: it is not claiming the fields are missing
 * from the product, and it is not quietly crediting the extractor for them.
 */
export const ENRICHMENT_FILLED_FIELDS: ReadonlySet<string> = new Set([
  "industry",
  "companyRole",
  "buyers",
  "serviceLocations",
]);

/* ----------------------------------------------------------- comparison */

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const IGNORED_TOKENS = new Set([
  "the","a","an","and","of","in","for","llc","inc","co","company","services","service",
  "solutions","solution","group","com","www","https","http",
]);

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 1 && !IGNORED_TOKENS.has(token)),
  );
}

/** Same thing said differently: equal, contained, or mostly-overlapping. */
export function fuzzyEqual(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftTokens = tokens(a);
  const rightTokens = tokens(b);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function scoreSet(field: string, expected: string[], produced: string[]): FieldScore {
  const remaining = [...produced];
  let matched = 0;

  for (const want of expected) {
    const index = remaining.findIndex((candidate) => fuzzyEqual(want, candidate));
    if (index >= 0) {
      remaining.splice(index, 1);
      matched += 1;
    }
  }

  return { field, matched, expected: expected.length, produced: produced.length };
}

function scoreScalar(
  field: string,
  expected: string | number | null,
  produced: string | number | null | undefined,
  compare: (a: string, b: string) => boolean = fuzzyEqual,
): FieldScore {
  const has = expected !== null && expected !== "";
  const got = produced !== null && produced !== undefined && produced !== "";

  const matched =
    has && got && compare(String(expected), String(produced)) ? 1 : 0;

  return { field, matched, expected: has ? 1 : 0, produced: got ? 1 : 0 };
}

/** Hosts and paths, so `http://x.com/` and `https://www.x.com` agree. */
function sameUrl(a: string, b: string): boolean {
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  return strip(a) === strip(b) || fuzzyEqual(strip(a), strip(b));
}

/* --------------------------------------------------------------- scoring */

export function scoreSite(kb: KnowledgeBase, golden: GoldenProfile): SiteScore {
  const fields: FieldScore[] = [];

  /* ----------------------------------------------------------- exact */

  fields.push(
    scoreScalar("website", golden.exact.website, kb.foundation.website.value, sameUrl),
  );
  fields.push(scoreScalar("industry", golden.exact.industry, kb.foundation.industry.value));
  fields.push(
    scoreScalar("companyRole", golden.exact.companyRole, kb.foundation.companyRole.value),
  );
  fields.push(
    scoreScalar("yearFounded", golden.exact.yearFounded, kb.foundation.yearFounded.value, (a, b) => a === b),
  );
  fields.push(
    scoreScalar("legalEntityType", golden.exact.legalEntityType, kb.foundation.legalEntityType.value),
  );
  fields.push(
    scoreScalar("employeeCount", golden.exact.employeeCount, kb.foundation.employeeCount.value, (a, b) => a === b),
  );
  fields.push(scoreScalar("revenue", golden.exact.revenue, kb.foundation.revenue.value));
  fields.push(
    scoreScalar(
      "mainAddress",
      golden.exact.mainAddress,
      kb.foundation.mainAddress.value?.formatted ?? null,
    ),
  );
  fields.push(
    scoreScalar(
      "logoUrl",
      golden.exact.logoUrl,
      kb.branding.logos.value?.[0]?.url ?? null,
      sameUrl,
    ),
  );

  const producedSocials = (kb.onlinePresence.profiles.value ?? []).map(
    (profile) => `${profile.platform} ${profile.url}`,
  );
  const expectedSocials = Object.entries(golden.exact.socials).map(
    ([platform, url]) => `${platform} ${url}`,
  );
  fields.push(scoreSet("socials", expectedSocials, producedSocials));

  /* ------------------------------------------------------------ sets */

  fields.push(
    scoreSet("serviceLocations", golden.sets.serviceLocations, kb.foundation.serviceLocations.value ?? []),
  );
  fields.push(
    scoreSet(
      "otherLocations",
      golden.sets.otherLocations,
      (kb.foundation.otherLocations.value ?? []).map((address) => address.formatted),
    ),
  );
  fields.push(scoreSet("altNames", golden.sets.altNames, kb.foundation.altNames.value ?? []));
  fields.push(scoreSet("buyers", golden.sets.buyers, kb.market.buyers.value ?? []));
  fields.push(
    scoreSet("industryGroupings", golden.sets.industryGroupings, kb.market.industryGroupings.value ?? []),
  );
  fields.push(scoreSet("channels", golden.sets.channels, kb.market.channels.value ?? []));
  fields.push(scoreSet("funnels", golden.sets.funnels, kb.market.funnels.value ?? []));
  fields.push(scoreSet("ctas", golden.sets.ctas, kb.market.ctas.value ?? []));
  fields.push(
    scoreSet("suppliers", golden.sets.suppliers, kb.market.suppliersPartners.value ?? []),
  );
  fields.push(scoreSet("fonts", golden.sets.fonts, kb.branding.fonts.value ?? []));

  // Colours are compared exactly: a hex that is close is a different colour.
  const producedColors = (kb.branding.colors.value ?? []).map((color) => color.hex.toLowerCase());
  fields.push({
    field: "colors",
    matched: golden.sets.colors.filter((hex) => producedColors.includes(hex.toLowerCase())).length,
    expected: golden.sets.colors.length,
    produced: producedColors.length,
  });

  /* --------------------------------------------------------- records */

  fields.push(
    scoreSet(
      "people",
      golden.records.people.map((person) => person.name),
      (kb.people.value ?? []).map((person) => person.name),
    ),
  );
  fields.push(
    scoreSet(
      "offerings",
      golden.records.offerings.map((offering) => offering.name),
      (kb.offerings.value ?? []).map((offering) => offering.name),
    ),
  );

  return {
    slug: golden.slug,
    fields,
    matched: sum(fields, (field) => field.matched),
    expected: sum(fields, (field) => field.expected),
    produced: sum(fields, (field) => field.produced),
  };
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/** Recall — of what the reference found, how much did we find? */
export function recall(score: { matched: number; expected: number }): number {
  return score.expected === 0 ? 1 : score.matched / score.expected;
}

/** Micro-averaged per-field totals across every scored site. */
export function aggregate(sites: SiteScore[]): FieldScore[] {
  const byField = new Map<string, FieldScore>();

  for (const site of sites) {
    for (const field of site.fields) {
      const existing = byField.get(field.field);
      if (!existing) {
        byField.set(field.field, { ...field });
        continue;
      }
      existing.matched += field.matched;
      existing.expected += field.expected;
      existing.produced += field.produced;
    }
  }

  return [...byField.values()];
}
