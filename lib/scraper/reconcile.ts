import {
  createEmptyKnowledgeBase,
  notFound,
  type KnowledgeBase,
  type Sourced,
  type Conflict,
} from "@/lib/schema";
import { setPath, getPath } from "@/lib/utils/path";
import {
  METHOD_TIER,
  evidenceScore,
  sourceLabel,
  toExtractionMethod,
  type Evidence,
} from "./evidence";
import { quoteKey } from "./extractors/proof";
import { normalizeName } from "./extractors/offerings";

/**
 * Evidence in, knowledge base out.
 *
 * Two rules do all the work:
 *
 * 1. **Precedence beats confidence.** A JSON-LD claim always outranks a DOM one,
 *    regardless of how sure the DOM extractor was. Confidence and page role only
 *    break ties *within* a tier.
 * 2. **Competing claims at the same tier are surfaced, not resolved.** Two
 *    different phone numbers from two DOM extractions become a conflict the user
 *    settles with one tap. Silently picking one throws away information they
 *    could have confirmed in a second (docs/DATA-QUALITY.md §4).
 */

/** Paths holding a `Sourced<T[]>` of plain strings, unioned across pages. */
const STRING_LIST_PATHS = new Set([
  "foundation.otherLocations",
  "foundation.serviceLocations",
  "foundation.altNames",
  "market.buyers",
  "market.industryGroupings",
  "market.channels",
  "market.funnels",
  "market.ctas",
  "market.suppliersPartners",
  "branding.fonts",
]);

/** Paths holding a `Sourced<Record[]>`, deduped by the keys below. */
const RECORD_LIST_PATHS = new Map<string, (record: RecordLike) => string>([
  ["people", (record) => String(record.name ?? "").toLowerCase().trim()],
  ["offerings", (record) => normalizeName(String(record.name ?? ""))],
  ["branding.logos", (record) => String(record.url ?? "")],
  ["branding.colors", (record) => String(record.hex ?? "")],
  ["onlinePresence.profiles", (record) => String(record.url ?? "")],
  ["proof.testimonials", (record) => quoteKey(String(record.quote ?? ""))],
  ["proof.aggregateRatings", (record) => `${record.platform}|${record.ratingValue}`],
  ["proof.caseStudies", (record) => String(record.title ?? "").toLowerCase()],
  ["proof.certifications", (record) => String(record.name ?? "").toLowerCase()],
  ["proof.memberships", (record) => String(record.name ?? "").toLowerCase()],
  ["proof.awards", (record) => String(record.name ?? "").toLowerCase()],
  ["proof.pressMentions", (record) => String(record.outlet ?? "").toLowerCase()],
  ["proof.trustStats", (record) => String(record.claim ?? "").toLowerCase()],
  ["proof.guarantees", (record) => String(record.text ?? "").toLowerCase()],
  ["proof.clientLogos", (record) => String(record.url ?? "")],
  ["contentIntelligence.posts", (record) => String(record.url ?? "")],
  ["contentIntelligence.faqs", (record) => String(record.question ?? "").toLowerCase()],
  ["contentIntelligence.glossary", (record) => String(record.term ?? "").toLowerCase()],
  ["contentIntelligence.seasonalSignals", (record) => String(record.label ?? "").toLowerCase()],
  ["contentIntelligence.themes", (record) => String(record.label ?? "").toLowerCase()],
  ["contentIntelligence.contentGaps", (record) => String(record.topic ?? "").toLowerCase()],
  ["contentIntelligence.headlinePatterns", (record) => String(record.pattern ?? "")],
]);

type RecordLike = Record<string, unknown> & {
  id?: string;
  method?: string;
  confidence?: number;
  sourceUrls?: string[];
};

export type ReconcileResult = {
  knowledgeBase: KnowledgeBase;
  conflicts: Conflict[];
};

export function reconcile(
  evidence: Evidence[],
  base: KnowledgeBase = createEmptyKnowledgeBase({ sourceUrl: "" }),
): ReconcileResult {
  const byPath = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const bucket = byPath.get(item.path);
    if (bucket) bucket.push(item);
    else byPath.set(item.path, [item]);
  }

  let kb = base;
  const conflicts: Conflict[] = [];

  for (const [path, claims] of byPath) {
    if (RECORD_LIST_PATHS.has(path)) {
      kb = setPath(kb, path, reconcileRecords(path, claims));
    } else if (STRING_LIST_PATHS.has(path)) {
      kb = setPath(kb, path, reconcileStringList(claims));
    } else {
      const { field, conflict } = reconcileScalar(path, claims);
      kb = setPath(kb, path, field);
      if (conflict) conflicts.push(conflict);
    }
  }

  return { knowledgeBase: kb, conflicts };
}

/* --------------------------------------------------------------- scalars */

function reconcileScalar(
  path: string,
  claims: Evidence[],
): { field: Sourced<unknown>; conflict: Conflict | null } {
  const ranked = [...claims].sort(
    (a, b) => METHOD_TIER[b.method] - METHOD_TIER[a.method] || evidenceScore(b) - evidenceScore(a),
  );

  const winner = ranked[0];
  const topTier = METHOD_TIER[winner.method];

  // Only same-tier disagreement is a conflict. A DOM value losing to JSON-LD is
  // the precedence chain working, not something to ask the user about.
  const sameTier = ranked.filter((claim) => METHOD_TIER[claim.method] === topTier);
  const distinct = dedupeByValue(sameTier);

  const field: Sourced<unknown> = {
    value: winner.value,
    method: toExtractionMethod(winner.method),
    confidence: winner.confidence,
    sourceUrls: uniqueUrls(sameTier.filter((claim) => sameValue(claim, winner))),
  };

  if (distinct.length <= 1) {
    if (winner.note) field.note = winner.note;
    return { field, conflict: null };
  }

  const alternatives = distinct
    .filter((claim) => !sameValue(claim, winner))
    .map((claim) => format(claim.value));

  field.note = `We found ${distinct.length} different values: ${alternatives.join(", ")}`;
  // A contested value is not a confident one, whatever the extractor claimed.
  field.confidence = Math.min(field.confidence, 0.45);

  return {
    field,
    conflict: {
      path,
      label: path.split(".").pop() ?? path,
      candidates: distinct.map((claim) => ({
        value: claim.value,
        sourceUrl: claim.sourceUrl,
        sourceLabel: sourceLabel(claim),
        confidence: claim.confidence,
      })),
      resolved: false,
    },
  };
}

function sameValue(a: Evidence, b: Evidence): boolean {
  return format(a.value) === format(b.value);
}

function dedupeByValue(claims: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const claim of claims) {
    const key = format(claim.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(claim);
  }
  return out;
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Addresses compare on their formatted line, not on their parts.
    if (typeof record.formatted === "string") return record.formatted.toLowerCase();
    return JSON.stringify(value);
  }
  return String(value).trim().toLowerCase();
}

/* ---------------------------------------------------------- string lists */

function reconcileStringList(claims: Evidence[]): Sourced<string[]> {
  const values = new Map<string, Evidence>();

  for (const claim of claims) {
    for (const raw of Array.isArray(claim.value) ? claim.value : [claim.value]) {
      const value = String(raw).replace(/\s+/g, " ").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const existing = values.get(key);
      // Keep the best-sourced spelling of a repeated item.
      if (!existing || evidenceScore(claim) > evidenceScore(existing)) {
        values.set(key, { ...claim, value });
      }
    }
  }

  if (values.size === 0) return notFound<string[]>();

  const winners = [...values.values()];
  return {
    value: winners.map((claim) => claim.value as string),
    method: toExtractionMethod(bestMethod(winners)),
    confidence: average(winners.map((claim) => claim.confidence)),
    sourceUrls: uniqueUrls(winners),
  };
}

/* ---------------------------------------------------------- record lists */

function reconcileRecords(path: string, claims: Evidence[]): Sourced<RecordLike[]> {
  const keyOf = RECORD_LIST_PATHS.get(path)!;
  const merged = new Map<string, { record: RecordLike; claim: Evidence; urls: Set<string> }>();

  // An extractor may report "looked and found none" with an explanation — the
  // review-widget case. That note has to survive even though it carries no rows.
  const notes = claims
    .filter((claim) => claim.note && (!Array.isArray(claim.value) || claim.value.length === 0))
    .map((claim) => claim.note as string);

  for (const claim of claims) {
    const records = Array.isArray(claim.value) ? claim.value : [claim.value];
    for (const raw of records) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as RecordLike;
      const key = keyOf(record);
      if (!key) continue;

      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          record,
          claim,
          urls: new Set([claim.sourceUrl, ...(record.sourceUrls ?? [])]),
        });
        continue;
      }

      existing.urls.add(claim.sourceUrl);
      // Higher-tier evidence replaces the record but inherits every URL that
      // mentioned it, so "found on 4 pages" survives the swap.
      if (
        METHOD_TIER[claim.method] > METHOD_TIER[existing.claim.method] ||
        (METHOD_TIER[claim.method] === METHOD_TIER[existing.claim.method] &&
          evidenceScore(claim) > evidenceScore(existing.claim))
      ) {
        existing.record = mergeRecord(record, existing.record);
        existing.claim = claim;
      } else {
        existing.record = mergeRecord(existing.record, record);
      }
    }
  }

  if (merged.size === 0) {
    const empty: Sourced<RecordLike[]> = {
      value: [],
      method: "not-found",
      confidence: 0,
      sourceUrls: uniqueUrls(claims),
    };
    if (notes.length > 0) empty.note = notes.join(" ");
    return empty;
  }

  const entries = [...merged.values()];
  const value = entries.map((entry) => ({
    ...entry.record,
    method: toExtractionMethod(entry.claim.method),
    confidence: entry.claim.confidence,
    sourceUrls: [...entry.urls],
  }));

  const result: Sourced<RecordLike[]> = {
    value,
    method: toExtractionMethod(bestMethod(entries.map((entry) => entry.claim))),
    confidence: average(entries.map((entry) => entry.claim.confidence)),
    sourceUrls: uniqueUrls(entries.map((entry) => entry.claim)),
  };
  if (notes.length > 0) result.note = notes.join(" ");
  return result;
}

/** Fills gaps in `primary` from `secondary` without overwriting real values. */
function mergeRecord(primary: RecordLike, secondary: RecordLike): RecordLike {
  const merged: RecordLike = { ...primary };

  for (const [key, value] of Object.entries(secondary)) {
    if (key === "id" || key === "method" || key === "confidence" || key === "sourceUrls") continue;

    const current = merged[key];
    if (current === null || current === undefined || current === "") {
      merged[key] = value;
    } else if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = [...new Set([...current, ...value])];
    }
  }
  return merged;
}

/* --------------------------------------------------------------- helpers */

function bestMethod(claims: Evidence[]) {
  return claims.reduce((best, claim) =>
    METHOD_TIER[claim.method] > METHOD_TIER[best.method] ? claim : best,
  ).method;
}

function uniqueUrls(claims: Evidence[]): string[] {
  return [...new Set(claims.map((claim) => claim.sourceUrl).filter(Boolean))];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

/** True when a path is reconciled as a collection rather than a scalar. */
export function isCollectionPath(path: string): boolean {
  return RECORD_LIST_PATHS.has(path) || STRING_LIST_PATHS.has(path);
}

/** Reads a `Sourced<T>` back off a knowledge base by dot path. */
export function fieldAt(kb: KnowledgeBase, path: string): Sourced<unknown> | undefined {
  return getPath(kb, path) as Sourced<unknown> | undefined;
}
