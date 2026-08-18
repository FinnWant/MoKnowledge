import {
  FIELD_META,
  fieldMeta,
  knowledgeBaseSchema,
  needsReview,
  userEdited,
  type CategoryId,
  type Conflict,
  type FieldMeta,
  type KnowledgeBase,
  type RecordProvenance,
  type Sourced,
} from "@/lib/schema";
import { buildQuality } from "@/lib/scraper/analyzers/completeness";
import { getPath, setPath } from "@/lib/utils/path";

/**
 * The draft the user reviews, and every way it can change.
 *
 * A pure reducer in `lib/` rather than hooks in a component, for the reason
 * docs/EDIT-UX.md §3 gives: fields are addressed by path, so one reducer covers
 * ten categories without a case per field — and a pure one can be tested
 * against a real scraped knowledge base without a browser.
 *
 * `original` is never mutated. It is what makes per-field revert possible and
 * what tells us whether a field genuinely changed, which is the difference
 * between "you edited this" and "you looked at it".
 */

export type DraftState = {
  original: KnowledgeBase;
  draft: KnowledgeBase;
  /** Explicitly accepted by the user: leaves the attention tier, value unchanged. */
  reviewed: Set<string>;
  /** Changed from `original`. Drives the edit count and the unsaved-changes guard. */
  dirty: Set<string>;
  /** Deleted records, newest last, so a delete can be undone. */
  removed: RemovedRecord[];
  /** True only between a successful save and the next change. */
  saved: boolean;
};

export type RemovedRecord = {
  path: string;
  index: number;
  record: Record<string, unknown>;
  label: string;
};

export type ConflictChoice = { index: number } | { value: unknown };

export type DraftAction =
  | { type: "SET_FIELD"; path: string; value: unknown }
  | { type: "ACCEPT_FIELD"; path: string }
  | { type: "ACCEPT_ALL_SAFE" }
  | { type: "ACCEPT_CATEGORY"; category: CategoryId }
  | { type: "RESOLVE_CONFLICT"; path: string; choice: ConflictChoice }
  | { type: "REVERT_FIELD"; path: string }
  | { type: "ADD_ITEM"; path: string; record: Record<string, unknown> }
  | { type: "UPDATE_ITEM"; path: string; id: string; patch: Record<string, unknown> }
  | { type: "REMOVE_ITEM"; path: string; id: string }
  | { type: "UNDO_REMOVE" }
  | { type: "REORDER"; path: string; from: number; to: number }
  | { type: "ANSWER_QUESTION"; id: string; answers: Record<string, unknown> }
  | { type: "MARK_SAVED"; knowledgeBase: KnowledgeBase }
  | { type: "RESTORE"; state: DraftState };

export function createDraft(knowledgeBase: KnowledgeBase): DraftState {
  return {
    original: knowledgeBase,
    draft: knowledgeBase,
    reviewed: new Set(),
    dirty: new Set(),
    removed: [],
    saved: false,
  };
}

/* ---------------------------------------------------------------- reducer */

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "RESTORE":
      return action.state;

    case "MARK_SAVED":
      return {
        ...state,
        original: action.knowledgeBase,
        draft: action.knowledgeBase,
        dirty: new Set(),
        removed: [],
        saved: true,
      };

    case "SET_FIELD":
      return writeField(state, action.path, action.value);

    case "ACCEPT_FIELD":
      return { ...state, reviewed: withAdded(state.reviewed, action.path) };

    case "ACCEPT_ALL_SAFE": {
      const reviewed = new Set(state.reviewed);
      for (const path of safeToAccept(state)) reviewed.add(path);
      return { ...state, reviewed };
    }

    case "ACCEPT_CATEGORY": {
      const reviewed = new Set(state.reviewed);
      for (const item of attentionFields(state)) {
        if (item.meta.category === action.category) reviewed.add(item.meta.path);
      }
      return { ...state, reviewed };
    }

    case "RESOLVE_CONFLICT":
      return resolveConflict(state, action.path, action.choice);

    case "REVERT_FIELD": {
      const restored = getPath(state.original, action.path);
      if (restored === undefined) return state;

      const dirty = new Set(state.dirty);
      dirty.delete(action.path);
      const reviewed = new Set(state.reviewed);
      reviewed.delete(action.path);

      return rescore({
        ...state,
        draft: setPath(state.draft, action.path, restored),
        dirty,
        reviewed,
        saved: false,
      });
    }

    case "ADD_ITEM": {
      const items = itemsAt(state.draft, action.path);
      return writeCollection(state, action.path, [...items, action.record]);
    }

    case "UPDATE_ITEM": {
      const items = itemsAt(state.draft, action.path);
      const next = items.map((item, position) =>
        matchesId(item, position, action.id)
          ? // A record carries its own provenance, so an edit to one person does
            // not restamp the other twenty-nine.
            { ...item, ...action.patch, method: "user-edited", confidence: 1 }
          : item,
      );
      return writeCollection(state, action.path, next);
    }

    case "REMOVE_ITEM": {
      const items = itemsAt(state.draft, action.path);
      const index = items.findIndex((item, position) =>
        matchesId(item, position, action.id),
      );
      if (index < 0) return state;

      const record = items[index];
      const next = writeCollection(
        state,
        action.path,
        items.filter((_, position) => position !== index),
      );

      return {
        ...next,
        // Stashed rather than confirmed: docs/EDIT-UX.md §4 prefers a reversible
        // delete to an interruptive dialog, and somebody reviewing fourteen
        // offerings should not have to answer "are you sure" fourteen times.
        removed: [
          ...state.removed,
          { path: action.path, index, record, label: recordLabel(record) },
        ],
      };
    }

    case "UNDO_REMOVE": {
      const last = state.removed.at(-1);
      if (!last) return state;

      const items = itemsAt(state.draft, last.path);
      const next = [...items];
      next.splice(Math.min(last.index, next.length), 0, last.record);

      return {
        ...writeCollection(state, last.path, next),
        removed: state.removed.slice(0, -1),
      };
    }

    case "REORDER": {
      const items = itemsAt(state.draft, action.path);
      if (
        action.from === action.to ||
        action.from < 0 ||
        action.to < 0 ||
        action.from >= items.length ||
        action.to >= items.length
      ) {
        return state;
      }

      const next = [...items];
      const [moved] = next.splice(action.from, 1);
      next.splice(action.to, 0, moved);
      return writeCollection(state, action.path, next);
    }

    case "ANSWER_QUESTION": {
      let next = state;
      for (const [path, value] of Object.entries(action.answers)) {
        if (isEmptyAnswer(value)) continue;
        next = writeField(next, path, value);
      }
      if (next === state) return state;

      // The question disappears on its own once the field it fills is no longer
      // empty — `buildQuality` regenerates the list from the gaps that remain.
      return next;
    }

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ writes */

function writeField(state: DraftState, path: string, value: unknown): DraftState {
  const current = getPath(state.draft, path) as Sourced<unknown> | undefined;
  if (!current) return state;

  const normalized = normalizeValue(value);
  const field = userEdited(normalized, current);

  const dirty = new Set(state.dirty);
  const originalField = getPath(state.original, path) as Sourced<unknown> | undefined;
  // Typing a value back to what it already was is not an edit. Without this the
  // unsaved-changes guard fires after a user opens an editor and closes it.
  if (sameValue(originalField?.value ?? null, normalized)) {
    dirty.delete(path);
  } else {
    dirty.add(path);
  }

  return rescore({
    ...state,
    draft: setPath(state.draft, path, field),
    dirty,
    reviewed: withAdded(state.reviewed, path),
    saved: false,
  });
}

function writeCollection(
  state: DraftState,
  path: string,
  items: Array<Record<string, unknown>>,
): DraftState {
  const current = getPath(state.draft, path) as Sourced<unknown> | undefined;
  if (!current) return state;

  const originalItems = itemsAt(state.original, path);
  const dirty = new Set(state.dirty);
  if (sameValue(originalItems, items)) dirty.delete(path);
  else dirty.add(path);

  return rescore({
    ...state,
    draft: setPath(state.draft, path, {
      ...current,
      value: items,
      // The collection's own envelope only becomes "yours" when it had nothing
      // in it before; otherwise it keeps saying where the list came from and the
      // records carry the per-record provenance.
      method: current.value === null ? "user-edited" : current.method,
      confidence: current.value === null ? 1 : current.confidence,
    } satisfies Sourced<unknown>),
    dirty,
    reviewed: withAdded(state.reviewed, path),
    saved: false,
  });
}

function resolveConflict(
  state: DraftState,
  path: string,
  choice: ConflictChoice,
): DraftState {
  const conflict = state.draft.quality.conflicts.find((entry) => entry.path === path);
  if (!conflict) return state;

  const chosen =
    "index" in choice ? conflict.candidates[choice.index]?.value : choice.value;
  if (chosen === undefined) return state;

  const current = getPath(state.draft, path) as Sourced<unknown> | undefined;
  if (!current) return state;

  const rejected = conflict.candidates
    .filter((candidate) => !sameValue(candidate.value, chosen))
    .map((candidate) => `${format(candidate.value)} (${candidate.sourceLabel})`);

  // Confirming the value that was already there is not an edit — it keeps its
  // provenance and simply stops being a question. Choosing differently is.
  const keepsProvenance = sameValue(current.value, chosen);
  const field: Sourced<unknown> = keepsProvenance
    ? { ...current, confidence: 1, note: rejectionNote(rejected) }
    : { ...userEdited(chosen, current), note: rejectionNote(rejected) };

  const dirty = new Set(state.dirty);
  if (keepsProvenance) dirty.delete(path);
  else dirty.add(path);

  const conflicts: Conflict[] = state.draft.quality.conflicts.map((entry) =>
    entry.path === path ? { ...entry, resolved: true } : entry,
  );

  return rescore(
    {
      ...state,
      draft: setPath(state.draft, path, field),
      dirty,
      reviewed: withAdded(state.reviewed, path),
      saved: false,
    },
    conflicts,
  );
}

function rejectionNote(rejected: string[]): string | undefined {
  if (rejected.length === 0) return undefined;
  // Kept rather than discarded: the other value was on the site, and a later
  // reader deserves to know it was a choice rather than the only answer.
  return `You chose this over ${rejected.join(", ")}.`;
}

/**
 * Recomputes completeness after every change.
 *
 * The meter and the follow-up questions are the two things a reviewer watches
 * while they work; a score that only refreshed on save would make filling a gap
 * feel like it did nothing.
 */
function rescore(state: DraftState, conflicts?: Conflict[]): DraftState {
  const quality = buildQuality(
    state.draft,
    conflicts ?? state.draft.quality.conflicts,
  );

  return {
    ...state,
    draft: {
      ...state.draft,
      quality,
      updatedAt: state.draft.updatedAt,
    },
  };
}

/* ---------------------------------------------------------------- readers */

export type AttentionItem = {
  meta: FieldMeta;
  field: Sourced<unknown>;
  /** A conflict is a choice, not a confirmation — the UI renders it differently. */
  conflict: Conflict | null;
};

/**
 * The attention tier: low confidence, a reconciler conflict, or AI-generated,
 * minus anything the user has already accepted (docs/EDIT-UX.md §2).
 */
export function attentionFields(state: DraftState): AttentionItem[] {
  const conflicts = new Map(
    state.draft.quality.conflicts
      .filter((conflict) => !conflict.resolved)
      .map((conflict) => [conflict.path, conflict]),
  );

  const items: AttentionItem[] = [];
  for (const meta of FIELD_META) {
    if (state.reviewed.has(meta.path)) continue;
    const field = getPath(state.draft, meta.path) as Sourced<unknown> | undefined;
    if (!field || !needsReview(field)) continue;
    items.push({ meta, field, conflict: conflicts.get(meta.path) ?? null });
  }

  // Conflicts first: they are the only items where we genuinely don't know the
  // answer, and they take one tap to settle.
  return items.sort((a, b) => {
    if (Boolean(a.conflict) !== Boolean(b.conflict)) return a.conflict ? -1 : 1;
    return b.meta.impact - a.meta.impact;
  });
}

/**
 * Attention items that are low-confidence but uncontested — no competing value,
 * not AI-written. `Accept all safe` clears exactly these, which is what takes
 * the common case from "review six things" to "review two".
 *
 * "Uncontested" means no unresolved conflict, not "no note". The reconciler
 * writes notes for two different things: a genuine disagreement (which always
 * comes with a conflict record) and a caveat — "social sharing image; may not be
 * the logo". The second is a remark about one value, and holding it back from
 * bulk-accept would leave the button with nothing to do on a real scrape.
 */
export function safeToAccept(state: DraftState): string[] {
  return attentionFields(state)
    .filter(
      (item) =>
        !item.conflict &&
        item.field.method !== "ai-live" &&
        item.field.method !== "ai-mock",
    )
    .map((item) => item.meta.path);
}

export function openConflicts(state: DraftState): Conflict[] {
  return state.draft.quality.conflicts.filter((conflict) => !conflict.resolved);
}

export function editCount(state: DraftState): number {
  return state.dirty.size;
}

export function hasUnsavedWork(state: DraftState): boolean {
  return !state.saved;
}

/** Records the user removed, for the undo toast. */
export function lastRemoved(state: DraftState): RemovedRecord | null {
  return state.removed.at(-1) ?? null;
}

/* ----------------------------------------------------------- persistence */

/** localStorage key: one draft per scraped site (docs/EDIT-UX.md §8). */
export function draftStorageKey(sourceUrl: string): string {
  return `moknowledge:draft:${sourceUrl}`;
}

type SerializedDraft = {
  original: KnowledgeBase;
  draft: KnowledgeBase;
  reviewed: string[];
  dirty: string[];
  removed: RemovedRecord[];
  saved: boolean;
};

export function serializeDraft(state: DraftState): string {
  const payload: SerializedDraft = {
    original: state.original,
    draft: state.draft,
    reviewed: [...state.reviewed],
    dirty: [...state.dirty],
    removed: state.removed,
    saved: state.saved,
  };
  return JSON.stringify(payload);
}

/**
 * Restores an autosaved draft, or returns null.
 *
 * Both knowledge bases go through the schema on the way back in: `localStorage`
 * is the one input we can't validate at the source, and a draft written by an
 * older build must not be able to crash the editor.
 */
export function restoreDraft(raw: string): DraftState | null {
  let parsed: SerializedDraft;
  try {
    parsed = JSON.parse(raw) as SerializedDraft;
  } catch {
    return null;
  }

  const original = knowledgeBaseSchema.safeParse(parsed.original);
  const draft = knowledgeBaseSchema.safeParse(parsed.draft);
  if (!original.success || !draft.success) return null;

  return {
    original: original.data,
    draft: draft.data,
    reviewed: new Set(parsed.reviewed ?? []),
    dirty: new Set(parsed.dirty ?? []),
    removed: parsed.removed ?? [],
    saved: parsed.saved ?? false,
  };
}

/* ----------------------------------------------------------------- shared */

function itemsAt(kb: KnowledgeBase, path: string): Array<Record<string, unknown>> {
  const field = getPath(kb, path) as Sourced<unknown> | undefined;
  return Array.isArray(field?.value)
    ? (field.value as Array<Record<string, unknown>>)
    : [];
}

/**
 * Records normally carry an id, but not all of them do: `otherLocations` holds
 * plain addresses, because an address is a value rather than a thing with
 * provenance. Those are addressed by position instead.
 */
function matchesId(
  item: Record<string, unknown>,
  position: number,
  id: string,
): boolean {
  return typeof item.id === "string" ? item.id === id : String(position) === id;
}

function withAdded(set: Set<string>, value: string): Set<string> {
  if (set.has(value)) return set;
  const next = new Set(set);
  next.add(value);
  return next;
}

/** Empty string, empty array, and `null` all mean "the user cleared this". */
function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (Array.isArray(value) && value.length === 0) return null;
  return value;
}

function isEmptyAnswer(value: unknown): boolean {
  return normalizeValue(value) === null || value === undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function recordLabel(record: Record<string, unknown>): string {
  for (const key of ["name", "title", "quote", "question", "term", "claim", "text", "label", "platform", "outlet", "formatted"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.length > 40 ? `${value.slice(0, 40)}…` : value;
    }
  }
  return "the item";
}

/** Plain-language name for a path, for toasts and conflict headings. */
export function labelFor(path: string): string {
  return fieldMeta(path)?.label ?? path;
}

/** A record's provenance, for the card badge. */
export function provenanceOf(record: Record<string, unknown>): RecordProvenance | null {
  return typeof record.id === "string" && typeof record.method === "string"
    ? (record as unknown as RecordProvenance)
    : null;
}
