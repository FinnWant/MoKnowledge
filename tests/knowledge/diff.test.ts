import { describe, expect, it } from "vitest";
import { loadCrawlResult } from "../fixtures/load";
import {
  applyChanges,
  changedOnly,
  classify,
  countChanges,
  describeField,
  diffKnowledgeBases,
  diffLines,
} from "@/lib/knowledge/diff";
import {
  fieldMeta,
  notFound,
  scraped as scrapedValue,
  userEdited,
  type FieldMeta,
  type KnowledgeBase,
  type Sourced,
} from "@/lib/schema";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";
import { getPath, setPath } from "@/lib/utils/path";

/**
 * The version and re-scrape diff (R14).
 *
 * The load-bearing test is the first one: two builds of the *same* crawl must
 * report no changes. Every record is minted with a fresh `crypto.randomUUID`, so
 * a diff that compared stored values would call all fourteen offerings changed
 * and the re-scrape flow would be noise from the first day.
 */

const CLOCK = new Date("2026-02-13T00:00:00.000Z");

function build(): KnowledgeBase {
  return buildKnowledgeBase(loadCrawlResult("bee-cave-drilling"), {
    now: CLOCK,
    enrich: false,
  }).knowledgeBase;
}

function meta(path: string): FieldMeta {
  const found = fieldMeta(path);
  if (!found) throw new Error(`No field meta for ${path}`);
  return found;
}

// Both builds happen at import, not inside a test: running the extraction
// pipeline over a twenty-page fixture costs seconds, and that is setup rather
// than the thing being measured.
const original = build();
const rebuilt = build();

describe("comparing two knowledge bases", () => {
  it("reports no change between two builds of the same crawl", () => {
    // The ids genuinely differ — otherwise this test proves nothing.
    const first = (original.offerings.value ?? [])[0];
    const second = (rebuilt.offerings.value ?? [])[0];
    if (first && second) expect(first.id).not.toBe(second.id);

    expect(changedOnly(diffKnowledgeBases(original, rebuilt))).toEqual([]);
  });

  it("names what happened to each field", () => {
    expect(classify([], ["Austin"])).toBe("added");
    expect(classify(["Austin"], [])).toBe("removed");
    expect(classify(["Austin"], ["Bee Cave"])).toBe("changed");
    expect(classify(["Austin"], ["Austin"])).toBe("unchanged");
    expect(classify([], [])).toBe("unchanged");
  });

  it("sees a scalar edit", () => {
    const after = setPath(original, "foundation.phone", userEdited("(512) 555-0100"));
    const change = changedOnly(diffKnowledgeBases(original, after));

    expect(change).toHaveLength(1);
    expect(change[0].meta.path).toBe("foundation.phone");
    expect(change[0].after).toEqual(["(512) 555-0100"]);
  });

  it("sees a record appear in a collection", () => {
    const people = original.people.value ?? [];
    const after = setPath(original, "people", {
      ...original.people,
      value: [...people, { ...people[0], id: "new-person", name: "Dana Reyes", title: "Foreman" }],
    });

    const [change] = changedOnly(diffKnowledgeBases(original, after));
    expect(change.meta.path).toBe("people");
    expect(change.kind).toBe("changed");
    expect(change.after.some((line) => line.includes("Dana Reyes"))).toBe(true);
  });

  it("counts a field the site dropped as gone, not as empty", () => {
    const after = setPath(original, "foundation.email", notFound());
    const [change] = changedOnly(diffKnowledgeBases(original, after));

    // Only meaningful if the fixture actually has an email; guard rather than
    // assume, so the test says something either way.
    if ((original.foundation.email.value ?? null) !== null) {
      expect(change.kind).toBe("removed");
      expect(change.after).toEqual([]);
    }
  });

  it("carries both envelopes, so an edited field can warn before it is overwritten", () => {
    const edited = setPath(original, "foundation.industry", userEdited("Water well drilling"));
    const incoming = setPath(edited, "foundation.industry", scrapedValue("Drilling contractor", "https://x/"));

    const [change] = changedOnly(diffKnowledgeBases(edited, incoming));
    expect(change.current.method).toBe("user-edited");
    expect(change.incoming.method).toBe("scraped");
  });

  it("totals the changes for the summary line", () => {
    const after = setPath(
      setPath(original, "foundation.phone", userEdited("(512) 555-0100")),
      "foundation.revenue",
      userEdited("$2M"),
    );

    const counts = countChanges(diffKnowledgeBases(original, after));
    expect(counts.total).toBe(2);
    expect(counts.added + counts.changed).toBe(2);
  });
});

describe("describeField", () => {
  it("renders a collection as one line per record", () => {
    const lines = describeField(meta("people"), original.people);
    expect(lines.length).toBe((original.people.value ?? []).length);
  });

  it("renders chips as their own strings", () => {
    const field = { ...original.foundation.serviceLocations, value: ["Austin", "Bee Cave"] };
    expect(describeField(meta("foundation.serviceLocations"), field)).toEqual([
      "Austin",
      "Bee Cave",
    ]);
  });

  it("renders a composite as labelled rows", () => {
    const lines = describeField(meta("foundation.mainAddress"), original.foundation.mainAddress);
    if (original.foundation.mainAddress.value) {
      expect(lines.some((line) => line.startsWith("Address:"))).toBe(true);
    }
  });

  it("says nothing for an empty field rather than inventing a placeholder", () => {
    expect(describeField(meta("foundation.revenue"), notFound())).toEqual([]);
    expect(describeField(meta("foundation.revenue"), undefined)).toEqual([]);
  });
});

describe("diffLines", () => {
  it("reports what moved, not that the order changed", () => {
    const lines = diffLines(["Austin", "Bee Cave"], ["Bee Cave", "Austin", "Lakeway"]);

    expect(lines.filter((line) => line.status === "added").map((line) => line.text)).toEqual([
      "Lakeway",
    ]);
    expect(lines.filter((line) => line.status === "removed")).toEqual([]);
    expect(lines.filter((line) => line.status === "same")).toHaveLength(2);
  });

  it("keeps a removed line so it can be shown struck through", () => {
    const lines = diffLines(["Austin"], []);
    expect(lines).toEqual([{ text: "Austin", status: "removed" }]);
  });
});

describe("applyChanges", () => {
  const edited = setPath(original, "foundation.industry", userEdited("Water well drilling"));
  const incoming = setPath(
    setPath(edited, "foundation.industry", scrapedValue("Drilling contractor", "https://x/")),
    "foundation.revenue",
    scrapedValue("$2M", "https://x/"),
  );
  const changes = changedOnly(diffKnowledgeBases(edited, incoming));

  it("takes only the fields that were accepted", () => {
    const applied = applyChanges(edited, changes, ["foundation.revenue"]);

    expect(applied.foundation.revenue.value).toBe("$2M");
    // The whole point: a hand-corrected field survives a re-scrape that would
    // have reclaimed it.
    expect(applied.foundation.industry.value).toBe("Water well drilling");
    expect(applied.foundation.industry.method).toBe("user-edited");
  });

  it("keeps the incoming provenance on what it does take", () => {
    const applied = applyChanges(edited, changes, ["foundation.revenue"]);
    const field = getPath(applied, "foundation.revenue") as Sourced<unknown>;
    expect(field.method).toBe("scraped");
  });

  it("re-scores, because accepting a field changes completeness", () => {
    const applied = applyChanges(edited, changes, ["foundation.revenue"]);
    expect(applied.quality.overallScore).not.toBe(edited.quality.overallScore);
  });

  it("returns the original untouched when nothing was accepted", () => {
    expect(applyChanges(edited, changes, [])).toBe(edited);
  });
});
