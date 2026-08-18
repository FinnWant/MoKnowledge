import { beforeEach, describe, expect, it } from "vitest";
import { loadCrawlResult } from "../fixtures/load";
import {
  attentionFields,
  createDraft,
  draftReducer,
  editCount,
  restoreDraft,
  safeToAccept,
  serializeDraft,
  type DraftAction,
  type DraftState,
} from "@/lib/knowledge/draft";
import { blankRecord } from "@/lib/knowledge/records";
import { knowledgeBaseSchema, type Conflict, type KnowledgeBase, type Sourced } from "@/lib/schema";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { getPath, setPath } from "@/lib/utils/path";

/**
 * The draft reducer, over a real scraped knowledge base.
 *
 * The acceptance criteria for P5 are behavioural — "click Save with zero edits
 * and get a good knowledge base", "edit any field and see `You edited`",
 * "`Accept all safe` clears uncontested items" — so they are asserted here
 * rather than described.
 */

const CLOCK = new Date("2026-02-13T00:00:00.000Z");

const scraped: KnowledgeBase = buildKnowledgeBase(
  loadCrawlResult("bee-cave-drilling"),
  { now: CLOCK, enrich: false },
).knowledgeBase;

function run(state: DraftState, ...actions: DraftAction[]): DraftState {
  return actions.reduce(draftReducer, state);
}

function field(state: DraftState, path: string): Sourced<unknown> {
  return getPath(state.draft, path) as Sourced<unknown>;
}

let draft: DraftState;

beforeEach(() => {
  draft = createDraft(scraped);
});

describe("saving without touching anything", () => {
  it("still produces a schema-valid knowledge base", () => {
    const parsed = knowledgeBaseSchema.safeParse(draft.draft);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(editCount(draft)).toBe(0);
  });
});

describe("SET_FIELD", () => {
  it("marks the value as the user's, at full confidence", () => {
    const next = run(draft, {
      type: "SET_FIELD",
      path: "foundation.industry",
      value: "Water well drilling",
    });

    expect(field(next, "foundation.industry")).toMatchObject({
      value: "Water well drilling",
      method: "user-edited",
      confidence: 1,
    });
    expect(editCount(next)).toBe(1);
  });

  it("treats an empty string as clearing the field", () => {
    const next = run(draft, { type: "SET_FIELD", path: "foundation.industry", value: "   " });
    expect(field(next, "foundation.industry").value).toBeNull();
  });

  it("does not count typing a value back to what it was as an edit", () => {
    const original = field(draft, "foundation.industry").value as string;
    const next = run(
      draft,
      { type: "SET_FIELD", path: "foundation.industry", value: "Something else" },
      { type: "SET_FIELD", path: "foundation.industry", value: original },
    );

    expect(editCount(next)).toBe(0);
  });

  it("rescores completeness as gaps are filled", () => {
    const before = draft.draft.quality.overallScore;
    const next = run(draft, {
      type: "SET_FIELD",
      path: "foundation.employeeCount",
      value: 32,
    });

    expect(next.draft.quality.overallScore).toBeGreaterThan(before);
    expect(next.draft.quality.missingFields).not.toContain("foundation.employeeCount");
    // The question that asked for it is gone, because the gap is gone.
    expect(
      next.draft.quality.followUpQuestions.some((question) =>
        question.fills.includes("foundation.employeeCount"),
      ),
    ).toBe(false);
  });
});

describe("REVERT_FIELD", () => {
  it("puts the scraper's value and provenance back", () => {
    const before = field(draft, "companyName");
    const next = run(
      draft,
      { type: "SET_FIELD", path: "companyName", value: "Something else" },
      { type: "REVERT_FIELD", path: "companyName" },
    );

    expect(field(next, "companyName")).toEqual(before);
    expect(editCount(next)).toBe(0);
  });
});

describe("the attention tier", () => {
  it("drops an item once it is accepted", () => {
    const first = attentionFields(draft)[0];
    expect(first).toBeDefined();

    const next = run(draft, { type: "ACCEPT_FIELD", path: first.meta.path });
    expect(attentionFields(next).map((item) => item.meta.path)).not.toContain(
      first.meta.path,
    );
    // Accepting changes nothing about the value — that is the point of it.
    expect(field(next, first.meta.path)).toEqual(field(draft, first.meta.path));
    expect(editCount(next)).toBe(0);
  });

  it("Accept all safe clears the uncontested items and leaves the rest", () => {
    const withConflict = createDraft(withPhoneConflict(scraped));
    const before = attentionFields(withConflict);
    const safe = safeToAccept(withConflict);
    expect(safe.length).toBeGreaterThan(0);

    const next = run(withConflict, { type: "ACCEPT_ALL_SAFE" });
    const after = attentionFields(next);

    expect(after.length).toBe(before.length - safe.length);
    // A conflict is a question, not a low-confidence guess: it survives.
    expect(after.some((item) => item.conflict)).toBe(true);
    expect(safeToAccept(next)).toHaveLength(0);
  });

  it("never offers to bulk-accept AI-written prose", () => {
    const generated = setPath(scraped, "positioning.pitch", {
      value: "A placeholder pitch.",
      method: "ai-mock",
      confidence: 0.5,
      sourceUrls: [],
    });

    expect(safeToAccept(createDraft(generated))).not.toContain("positioning.pitch");
  });
});

describe("conflicts", () => {
  it("keeps the rejected value in a note instead of discarding it", () => {
    const state = createDraft(withPhoneConflict(scraped));
    const next = run(state, {
      type: "RESOLVE_CONFLICT",
      path: "foundation.phone",
      choice: { index: 1 },
    });

    const phone = field(next, "foundation.phone");
    expect(phone.value).toBe("512-894-0055");
    expect(phone.method).toBe("user-edited");
    expect(phone.note).toContain("512-273-7389");
    expect(next.draft.quality.conflicts[0].resolved).toBe(true);
    expect(attentionFields(next).some((item) => item.conflict)).toBe(false);
  });

  it("confirming the value already there is not an edit", () => {
    const state = createDraft(withPhoneConflict(scraped));
    const next = run(state, {
      type: "RESOLVE_CONFLICT",
      path: "foundation.phone",
      choice: { index: 0 },
    });

    expect(field(next, "foundation.phone").method).toBe("scraped");
    expect(editCount(next)).toBe(0);
  });

  it("accepts a value the user types instead", () => {
    const state = createDraft(withPhoneConflict(scraped));
    const next = run(state, {
      type: "RESOLVE_CONFLICT",
      path: "foundation.phone",
      choice: { value: "512-555-0123" },
    });

    expect(field(next, "foundation.phone")).toMatchObject({
      value: "512-555-0123",
      method: "user-edited",
    });
  });
});

describe("records", () => {
  const people = () => (scraped.people.value ?? []) as Array<{ id: string; name: string }>;

  it("adds a record already badged as the user's", () => {
    const record = { ...blankRecord("people"), name: "New Person" };
    const next = run(draft, { type: "ADD_ITEM", path: "people", record });

    const added = (next.draft.people.value ?? []).at(-1);
    expect(added).toMatchObject({ name: "New Person", method: "user-edited", confidence: 1 });
  });

  it("restamps only the record that changed", () => {
    const [first, second] = people();
    const next = run(draft, {
      type: "UPDATE_ITEM",
      path: "people",
      id: first.id,
      patch: { title: "Owner" },
    });

    const updated = (next.draft.people.value ?? []) as Array<Record<string, unknown>>;
    expect(updated[0]).toMatchObject({ title: "Owner", method: "user-edited" });
    expect(updated[1]).toMatchObject({ id: second.id, method: "scraped" });
  });

  it("puts a removed record back where it was", () => {
    const [, second] = people();
    const removed = run(draft, { type: "REMOVE_ITEM", path: "people", id: second.id });

    expect((removed.draft.people.value ?? []).map((person) => person.id)).not.toContain(second.id);
    expect(removed.removed.at(-1)?.label).toBe(second.name);

    const undone = run(removed, { type: "UNDO_REMOVE" });
    expect((undone.draft.people.value ?? [])[1]?.id).toBe(second.id);
    expect(undone.removed).toHaveLength(0);
  });

  it("reorders within the list and ignores impossible moves", () => {
    const [first, second] = people();
    const next = run(draft, { type: "REORDER", path: "people", from: 0, to: 1 });

    expect((next.draft.people.value ?? [])[0]?.id).toBe(second.id);
    expect((next.draft.people.value ?? [])[1]?.id).toBe(first.id);
    expect(run(next, { type: "REORDER", path: "people", from: 0, to: 99 })).toBe(next);
  });

  it("edits a record that has no id of its own", () => {
    // `otherLocations` holds plain addresses — a value, not a thing with
    // provenance — so the reducer addresses them by position.
    const withAddresses = setPath(scraped, "foundation.otherLocations", {
      value: [
        { formatted: "1 Main St", street: null, city: null, region: null, postalCode: null, country: null },
        { formatted: "4231 E Hwy 29", street: null, city: null, region: null, postalCode: null, country: null },
      ],
      method: "scraped",
      confidence: 0.8,
      sourceUrls: [],
    });

    const next = run(createDraft(withAddresses), {
      type: "REMOVE_ITEM",
      path: "foundation.otherLocations",
      id: "0",
    });

    expect(next.draft.foundation.otherLocations.value).toEqual([
      expect.objectContaining({ formatted: "4231 E Hwy 29" }),
    ]);
    expect(run(next, { type: "UNDO_REMOVE" }).draft.foundation.otherLocations.value).toHaveLength(2);
  });

  it("keeps the collection schema-valid after editing", () => {
    const next = run(
      draft,
      { type: "ADD_ITEM", path: "people", record: { ...blankRecord("people"), name: "Ada" } },
      { type: "REMOVE_ITEM", path: "people", id: people()[0].id },
      { type: "SET_FIELD", path: "foundation.yearFounded", value: 1980 },
    );

    const parsed = knowledgeBaseSchema.safeParse(next.draft);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });
});

describe("answering a gap question", () => {
  it("writes the answer into the field it fills", () => {
    const question = draft.draft.quality.followUpQuestions[0];
    expect(question).toBeDefined();

    const next = run(draft, {
      type: "ANSWER_QUESTION",
      id: question.id,
      answers: { [question.fills[0]]: "An answer" },
    });

    expect(field(next, question.fills[0]).method).toBe("user-edited");
  });

  it("ignores an empty answer", () => {
    const question = draft.draft.quality.followUpQuestions[0];
    const next = run(draft, {
      type: "ANSWER_QUESTION",
      id: question.id,
      answers: { [question.fills[0]]: "   " },
    });

    expect(next).toBe(draft);
  });
});

describe("autosave", () => {
  it("survives a round trip through localStorage", () => {
    const edited = run(draft, {
      type: "SET_FIELD",
      path: "foundation.industry",
      value: "Well drilling",
    });

    const restored = restoreDraft(serializeDraft(edited));
    expect(restored).not.toBeNull();
    expect(restored?.dirty.has("foundation.industry")).toBe(true);
    expect(restored?.draft.foundation.industry.value).toBe("Well drilling");
  });

  it("refuses a draft that is not a knowledge base", () => {
    expect(restoreDraft("not json")).toBeNull();
    expect(restoreDraft(JSON.stringify({ draft: { id: 1 }, original: {} }))).toBeNull();
  });
});

describe("MARK_SAVED", () => {
  it("clears the edit state and adopts the stored version", () => {
    const edited = run(draft, {
      type: "SET_FIELD",
      path: "foundation.industry",
      value: "Well drilling",
    });
    const stored = { ...edited.draft, version: 2 };
    const saved = run(edited, { type: "MARK_SAVED", knowledgeBase: stored });

    expect(saved.saved).toBe(true);
    expect(editCount(saved)).toBe(0);
    expect(saved.draft.version).toBe(2);
    // The saved version becomes the new baseline, so Revert goes back to it.
    expect(saved.original.version).toBe(2);
  });
});

/** A knowledge base with the two phone numbers a real reconciler conflict has. */
function withPhoneConflict(kb: KnowledgeBase): KnowledgeBase {
  const conflict: Conflict = {
    path: "foundation.phone",
    label: "Phone",
    candidates: [
      {
        value: "512-273-7389",
        sourceUrl: "https://beecavedrilling.com/contact",
        sourceLabel: "on the Contact page",
        confidence: 0.9,
      },
      {
        value: "512-894-0055",
        sourceUrl: "https://beecavedrilling.com/",
        sourceLabel: "in the footer",
        confidence: 0.6,
      },
    ],
    resolved: false,
  };

  const withField = setPath(kb, "foundation.phone", {
    value: "512-273-7389",
    method: "scraped",
    confidence: 0.9,
    sourceUrls: ["https://beecavedrilling.com/contact"],
    note: "We found 2 different phone numbers.",
  } satisfies Sourced<string>);

  return {
    ...withField,
    quality: { ...withField.quality, conflicts: [conflict] },
  };
}
