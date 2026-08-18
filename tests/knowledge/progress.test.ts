import { describe, expect, it } from "vitest";
import {
  initialProgress,
  pathOf,
  progressReducer,
  type ProgressState,
} from "@/lib/knowledge/progress";
import type { ScrapeEvent } from "@/lib/scraper/events";

/** Replays a sequence the way the page does, one event at a time. */
function replay(events: ScrapeEvent[]): ProgressState {
  return events.reduce(progressReducer, initialProgress);
}

const page = (url: string, fetched: number): ScrapeEvent => ({
  kind: "crawl",
  event: { type: "page", url, role: "other", fetched, budget: 20 },
});

describe("progressReducer", () => {
  it("tracks the running stage and the finished ones", () => {
    const state = replay([
      { kind: "stage", stage: "crawl", status: "start" },
      { kind: "stage", stage: "crawl", status: "done" },
      { kind: "stage", stage: "extract", status: "start" },
    ]);

    expect(state.stage).toBe("extract");
    expect(state.completed).toEqual(["crawl"]);
  });

  it("does not clear a stage that has already been replaced", () => {
    // The route emits `extract:start` immediately after `crawl:done`, but a
    // dropped or reordered frame must not leave the UI showing nothing.
    const state = replay([
      { kind: "stage", stage: "extract", status: "start" },
      { kind: "stage", stage: "crawl", status: "done" },
    ]);

    expect(state.stage).toBe("extract");
    expect(state.completed).toEqual(["crawl"]);
  });

  it("counts pages, budget and discovered links", () => {
    const state = replay([
      { kind: "crawl", event: { type: "start", url: "https://example.com" } },
      {
        kind: "crawl",
        event: { type: "robots", found: true, crawlDelayMs: 1000, sitemapCount: 1 },
      },
      { kind: "crawl", event: { type: "discovered", count: 12, source: "sitemap" } },
      { kind: "crawl", event: { type: "discovered", count: 5, source: "links" } },
      page("https://example.com/", 1),
      page("https://example.com/about", 2),
    ]);

    expect(state.pagesFetched).toBe(2);
    expect(state.budget).toBe(20);
    expect(state.discovered).toBe(17);
    expect(state.robots).toEqual({ found: true, crawlDelayMs: 1000 });
  });

  it("keeps only the most recent pages, newest first", () => {
    const state = replay(
      Array.from({ length: 12 }, (_, index) =>
        page(`https://example.com/page-${index}`, index + 1),
      ),
    );

    expect(state.pages).toHaveLength(8);
    expect(state.pages[0].url).toBe("https://example.com/page-11");
  });

  it("collapses repeated warnings", () => {
    const warning = {
      kind: "crawl" as const,
      event: {
        type: "warning" as const,
        warning: {
          code: "fetch-failed" as const,
          message: "That page took too long to answer.",
          url: "https://example.com/slow",
        },
      },
    };

    expect(replay([warning, warning, warning]).warnings).toHaveLength(1);
  });

  it("records the crawl duration", () => {
    const state = replay([
      { kind: "crawl", event: { type: "done", pagesFetched: 20, durationMs: 24_512 } },
    ]);
    expect(state.durationMs).toBe(24_512);
  });

  it("ignores terminal events — the page handles those itself", () => {
    const state = replay([
      page("https://example.com/", 1),
      { kind: "failed", message: "Nope.", hint: null },
    ]);
    expect(state.pagesFetched).toBe(1);
  });
});

describe("pathOf", () => {
  it("shortens a URL to what fits on a line", () => {
    expect(pathOf("https://example.com/")).toBe("/");
    expect(pathOf("https://example.com/about-us")).toBe("/about-us");
    expect(pathOf("https://example.com/search?q=well")).toBe("/search?q=well");
    expect(pathOf("nonsense")).toBe("nonsense");
  });
});
