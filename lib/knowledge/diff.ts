import {
  FIELD_META,
  type FieldMeta,
  type KnowledgeBase,
  type Sourced,
} from "@/lib/schema";
import { buildQuality } from "@/lib/scraper/analyzers/completeness";
import { getPath, setPath } from "@/lib/utils/path";
import {
  chipValues,
  displayKind,
  formatScalar,
  presentColors,
  presentComposite,
  presentMedia,
  presentRecords,
} from "./display";

/**
 * Comparing two knowledge bases, field by field.
 *
 * One engine serves both places docs/VIEW-PAGE.md asks for a diff: the version
 * history on the detail page, and re-scrape, which is the honest answer to the
 * six-month drift problem in docs/VALIDATION.md §2 — show what changed and let
 * the user accept per field, rather than silently overwriting reviewed data.
 *
 * **Values are compared as rendered, not as stored.** Every record carries an id
 * minted at extraction time, so a re-scrape of an unchanged page produces
 * structurally different objects holding identical content; a JSON comparison
 * would report all fourteen offerings as changed and the feature would be
 * useless. Comparing what a reader sees is also the right question to ask: a
 * diff exists to answer "is this different", not "was this rewritten".
 */

export type ChangeKind = "added" | "removed" | "changed" | "unchanged";

export type FieldChange = {
  meta: FieldMeta;
  kind: ChangeKind;
  /** The two values as displayed. One line per record, chip, or colour. */
  before: string[];
  after: string[];
  /** The envelope being replaced — `user-edited` here is a warning worth showing. */
  current: Sourced<unknown>;
  /** The incoming envelope, so accepting a change keeps its provenance. */
  incoming: Sourced<unknown>;
};

const EMPTY: Sourced<unknown> = {
  value: null,
  method: "not-found",
  confidence: 0,
  sourceUrls: [],
};

/**
 * A field's value as the lines a reader sees.
 *
 * Reuses the P4 presenters rather than a second formatting path, so a diff can
 * never disagree with the page it sits on.
 */
export function describeField(meta: FieldMeta, field: Sourced<unknown> | undefined): string[] {
  if (!field || field.value === null || field.value === undefined) return [];
  const { value } = field;

  switch (displayKind(meta)) {
    case "records":
      return presentRecords(meta.path, value).map((record) =>
        [record.title, record.subtitle].filter(Boolean).join(" — "),
      );
    case "chips":
      return chipValues(meta.path, value);
    case "color":
      return presentColors(value).map((color) => `${color.hex} (${color.role})`);
    case "media":
      return presentMedia(value).map((item) => item.url);
    case "composite":
      return presentComposite(meta.path, value).map(
        (detail) => `${detail.label}: ${detail.value}`,
      );
    default: {
      const scalar = formatScalar(meta, value);
      return scalar === null ? [] : [scalar];
    }
  }
}

export function classify(before: string[], after: string[]): ChangeKind {
  const wasEmpty = before.length === 0;
  const isEmpty = after.length === 0;

  if (wasEmpty && isEmpty) return "unchanged";
  if (wasEmpty) return "added";
  if (isEmpty) return "removed";
  return before.join("\n") === after.join("\n") ? "unchanged" : "changed";
}

/**
 * Every field, in schema order, with what happened to it. Unchanged fields are
 * included rather than filtered here — the version rail counts them and the
 * re-scrape panel hides them, and a caller that needs one shape should not have
 * to run the comparison twice to get the other.
 */
export function diffKnowledgeBases(
  before: KnowledgeBase,
  after: KnowledgeBase,
): FieldChange[] {
  return FIELD_META.map((meta) => {
    const previous = getPath(before, meta.path) as Sourced<unknown> | undefined;
    const incoming = getPath(after, meta.path) as Sourced<unknown> | undefined;

    const beforeLines = describeField(meta, previous);
    const afterLines = describeField(meta, incoming);

    return {
      meta,
      kind: classify(beforeLines, afterLines),
      before: beforeLines,
      after: afterLines,
      current: previous ?? EMPTY,
      incoming: incoming ?? EMPTY,
    };
  });
}

export function changedOnly(changes: FieldChange[]): FieldChange[] {
  return changes.filter((change) => change.kind !== "unchanged");
}

export type ChangeCounts = { added: number; removed: number; changed: number; total: number };

export function countChanges(changes: FieldChange[]): ChangeCounts {
  const counts: ChangeCounts = { added: 0, removed: 0, changed: 0, total: 0 };
  for (const change of changes) {
    if (change.kind === "unchanged") continue;
    counts[change.kind] += 1;
    counts.total += 1;
  }
  return counts;
}

/* ------------------------------------------------------------- line diffs */

export type DiffLine = { text: string; status: "same" | "added" | "removed" };

/**
 * Which individual records or chips moved, for a collection field.
 *
 * Set-based rather than positional: extraction order is not stable across
 * scrapes, and reporting "everything moved" because a new service appeared at
 * the top of the list would bury the one line that actually matters.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const previous = new Set(before);
  const incoming = new Set(after);

  const lines: DiffLine[] = after.map((text) => ({
    text,
    status: previous.has(text) ? "same" : "added",
  }));

  for (const text of before) {
    if (!incoming.has(text)) lines.push({ text, status: "removed" });
  }

  return lines;
}

/* ----------------------------------------------------------------- apply */

/**
 * Takes the incoming value for the accepted paths and nothing else.
 *
 * The unaccepted fields keep the value *and* the provenance they already had,
 * which is the whole point: a field the user corrected by hand must survive a
 * re-scrape that would have overwritten it with what the site still says.
 */
export function applyChanges(
  current: KnowledgeBase,
  changes: FieldChange[],
  acceptedPaths: Iterable<string>,
): KnowledgeBase {
  const accepted = new Set(acceptedPaths);
  let next = current;

  for (const change of changes) {
    if (!accepted.has(change.meta.path)) continue;
    next = setPath(next, change.meta.path, change.incoming);
  }

  if (next === current) return current;
  return { ...next, quality: buildQuality(next, next.quality.conflicts) };
}
