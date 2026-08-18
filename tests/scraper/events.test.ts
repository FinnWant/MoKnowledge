import { describe, expect, it } from "vitest";
import { encodeEvent, failureFor, type ScrapeEvent } from "@/lib/scraper/events";
import { createLineSplitter, readNdjson } from "@/lib/utils/ndjson";
import type { ScrapeWarning } from "@/lib/schema";

/**
 * The NDJSON transport, tested at the seam that actually breaks: chunk
 * boundaries. The result event carries a whole knowledge base and is always
 * split across several reads, so a parser that assumes one chunk is one line
 * works locally and fails on every real scrape.
 */

const warning = (code: ScrapeWarning["code"], message: string): ScrapeWarning => ({
  code,
  message,
  url: null,
});

describe("encodeEvent", () => {
  it("writes one line per event", () => {
    const line = encodeEvent({ kind: "stage", stage: "crawl", status: "start" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
  });

  it("escapes newlines inside values, so a line stays a record", () => {
    const line = encodeEvent({
      kind: "failed",
      message: "Line one\nline two",
      hint: null,
    });
    expect(line.split("\n")).toHaveLength(2);
    expect(JSON.parse(line)).toMatchObject({ message: "Line one\nline two" });
  });
});

describe("createLineSplitter", () => {
  it("holds an incomplete line until the rest arrives", () => {
    const splitter = createLineSplitter();
    expect(splitter.push('{"kind":"sta')).toEqual([]);
    expect(splitter.push('ge"}\n{"kind":"other"}')).toEqual(['{"kind":"stage"}']);
    expect(splitter.flush()).toEqual(['{"kind":"other"}']);
  });

  it("emits several lines from one chunk and skips blanks", () => {
    const splitter = createLineSplitter();
    expect(splitter.push("a\n\nb\n")).toEqual(["a", "b"]);
    expect(splitter.flush()).toEqual([]);
  });
});

describe("readNdjson", () => {
  it("reassembles events split across arbitrary chunk boundaries", async () => {
    const events: ScrapeEvent[] = [
      { kind: "stage", stage: "crawl", status: "start" },
      {
        kind: "crawl",
        event: { type: "page", url: "https://example.com/", role: "home", fetched: 1, budget: 20 },
      },
      { kind: "failed", message: "Nothing to read.", hint: null },
    ];

    const payload = events.map(encodeEvent).join("");
    const bytes = new TextEncoder().encode(payload);

    // Three bytes at a time: fine enough to split every line, and to split a
    // multi-byte character if one were present.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) {
          controller.enqueue(bytes.slice(index, index + 3));
        }
        controller.close();
      },
    });

    const received: ScrapeEvent[] = [];
    for await (const event of readNdjson<ScrapeEvent>(stream)) received.push(event);

    expect(received).toEqual(events);
  });

  it("keeps the good events when the stream is cut mid-line", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${encodeEvent({ kind: "stage", stage: "crawl", status: "start" })}{"kind":"cra`,
          ),
        );
        controller.close();
      },
    });

    const received: ScrapeEvent[] = [];
    for await (const event of readNdjson<ScrapeEvent>(stream)) received.push(event);

    expect(received).toEqual([{ kind: "stage", stage: "crawl", status: "start" }]);
  });
});

describe("failureFor", () => {
  it("leads with the reason, not the symptom", () => {
    const failure = failureFor([
      warning("fetch-failed", "We couldn't reach that page."),
      warning("robots-disallow", "This site asks automated tools not to read it."),
    ]);

    expect(failure.message).toBe(
      "This site asks automated tools not to read it.",
    );
    expect(failure.hint).toContain("robots.txt");
  });

  it("passes the crawler's own wording through", () => {
    const failure = failureFor([
      warning("js-rendered", "This site loads its content with JavaScript (Next.js)."),
    ]);

    expect(failure.message).toBe(
      "This site loads its content with JavaScript (Next.js).",
    );
    expect(failure.hint).toBeTruthy();
  });

  it("still says something useful with no warnings at all", () => {
    const failure = failureFor([]);
    expect(failure.message.length).toBeGreaterThan(0);
    expect(failure.hint).toBeTruthy();
  });
});
