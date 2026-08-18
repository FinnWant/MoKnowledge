import {
  FIELD_META,
  needsReview,
  type Address,
  type KnowledgeBase,
  type KnowledgeBaseSummary,
  type Offering,
  type Person,
  type Sourced,
} from "@/lib/schema";
import { getPath } from "@/lib/utils/path";

/**
 * The persistence seam (R20).
 *
 * One interface, two implementations: `LocalJsonAdapter` ships and runs with no
 * credentials, so a reviewer can clone the repo and save a knowledge base
 * immediately; the Supabase design in `docs/DATABASE.md` slots in behind the
 * same five methods. Nothing above this line knows which one it is talking to.
 *
 * Every save writes a new immutable version and moves a pointer, rather than
 * overwriting — an edited knowledge base is a record of what a business said
 * about itself on a date, and the previous answer is worth keeping.
 */

export type SavedVersion = {
  version: number;
  savedAt: string;
  /** Set when the version was produced by re-scraping rather than editing. */
  rescraped?: boolean;
};

export type StorageAdapter = {
  list(): Promise<KnowledgeBaseSummary[]>;
  /** The current version, or a specific one. `null` when it doesn't exist. */
  get(id: string, version?: number): Promise<KnowledgeBase | null>;
  /** Writes a new version and returns the knowledge base as stored. */
  save(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase>;
  remove(id: string): Promise<boolean>;
  versions(id: string): Promise<SavedVersion[]>;
};

/**
 * The trimmed shape the library lists, so `GET /api/knowledge-bases` never ships
 * a hundred full knowledge bases to render a grid of cards.
 */
export function toSummary(kb: KnowledgeBase): KnowledgeBaseSummary {
  const people = kb.people.value ?? [];
  const offerings = kb.offerings.value ?? [];
  const logo = (kb.branding.logos.value ?? [])[0]?.url ?? null;

  return {
    id: kb.id,
    version: kb.version,
    companyName: kb.companyName.value,
    sourceUrl: kb.sourceUrl,
    industry: kb.foundation.industry.value,
    logoUrl: logo,
    location: locationLine(kb),
    completeness: kb.quality.overallScore,
    peopleCount: people.length,
    offeringsCount: offerings.length,
    testimonialsCount: (kb.proof.testimonials.value ?? []).length,
    attentionCount: attentionCount(kb),
    conflictCount: kb.quality.conflicts.filter((conflict) => !conflict.resolved).length,
    keywords: keywords(kb, people, offerings),
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  };
}

/**
 * The one-line location, preferring the shape a person would say out loud.
 *
 * `formatted` is the whole postal address including the street, which is too
 * long for a card and not what distinguishes one record from another — "Dripping
 * Springs, TX" is. The full address is only used when the parts are missing,
 * which is the footer-regex case (see `addressSchema`).
 */
function locationLine(kb: KnowledgeBase): string | null {
  const address = kb.foundation.mainAddress.value ?? (kb.foundation.otherLocations.value ?? [])[0];
  const cityRegion = address ? cityRegionOf(address) : null;
  if (cityRegion) return cityRegion;
  if (address) return address.formatted;

  // No address anywhere is normal for a service business: three of the eight
  // reference profiles publish only the areas they serve.
  return (kb.foundation.serviceLocations.value ?? [])[0] ?? null;
}

function cityRegionOf(address: Address): string | null {
  const parts = [address.city, address.region].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** How many fields would land in the review page's attention tier. */
function attentionCount(kb: KnowledgeBase): number {
  let count = 0;
  for (const meta of FIELD_META) {
    const field = getPath(kb, meta.path) as Sourced<unknown> | undefined;
    if (field && needsReview(field)) count += 1;
  }
  return count;
}

/**
 * The extra strings search matches on.
 *
 * Capped, because the point of the summary is that it stays small: a record with
 * forty offerings contributes the first twelve, which is well past the number
 * anyone types into a search box to find it again.
 */
const KEYWORD_LIMIT = 12;

function keywords(
  kb: KnowledgeBase,
  people: Person[],
  offerings: Offering[],
): string[] {
  const terms = [
    ...(kb.foundation.altNames.value ?? []),
    ...(kb.foundation.serviceLocations.value ?? []),
    ...(kb.market.industryGroupings.value ?? []),
    ...offerings.slice(0, KEYWORD_LIMIT).map((offering) => offering.name),
    ...people.slice(0, KEYWORD_LIMIT).map((person) => person.name),
  ];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const trimmed = typeof term === "string" ? term.trim() : "";
    const key = trimmed.toLowerCase();
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}
