import type { EnrichmentReport } from "@/lib/ai/enrich";
import type { KnowledgeBase, ScrapeWarning, WarningCode } from "@/lib/schema";
import type { CrawlProgressEvent } from "./crawler";

/**
 * The wire protocol between `POST /api/scrape` and the scrape page.
 *
 * One `POST` that streams NDJSON, rather than a job store and a polling loop
 * (ROADMAP §3.2). A scrape of twenty pages takes ~25 seconds at the one-request-
 * per-second the etiquette rules require, so the user has to be told what is
 * happening — and the crawler already emits exactly the right events. This union
 * wraps them and adds the pipeline's own stages.
 *
 * `failed` is the only terminal state that isn't `result`. Everything the crawler
 * survives — a dead page, a robots block on one section, a JS-rendered site —
 * arrives as a warning attached to a real knowledge base instead.
 */

export type ScrapeStage = "crawl" | "extract" | "enrich";

export type ScrapeEvent =
  | { kind: "crawl"; event: CrawlProgressEvent }
  | { kind: "stage"; stage: ScrapeStage; status: "start" | "done" }
  | {
      kind: "result";
      knowledgeBase: KnowledgeBase;
      enrichment: EnrichmentReport | null;
    }
  /** The run produced nothing usable. `hint` is the next thing to try. */
  | { kind: "failed"; message: string; hint: string | null };

/** One event, one line. `JSON.stringify` escapes newlines, so a line is a record. */
export function encodeEvent(event: ScrapeEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/* ---------------------------------------------------------------- failure */

/**
 * What to tell the user when the crawl came back with nothing at all.
 *
 * The warning's own `message` already reads as plain English — every failure
 * mode in docs/DATA-QUALITY.md §7 is written for a non-technical reader at the
 * point it is detected — so this adds the part that message can't know: what to
 * do next.
 */
const HINTS: Record<WarningCode, string | null> = {
  "robots-disallow":
    "Only the site's owner can change that. If this is your site, ask whoever manages it about the robots.txt file.",
  "js-rendered":
    "Sites built this way need a browser to read them. Try a different address, or add the details by hand after scraping what we could.",
  "bot-challenge":
    "The site is behind a bot filter. Trying again later sometimes works; otherwise this one needs to be entered by hand.",
  "redirect-offsite":
    "That address forwards somewhere else. Try scraping the address it forwards to.",
  "non-html":
    "That link points at a file rather than a web page. Try the site's home page.",
  "fetch-failed":
    "Check the address for a typo, and try it in a browser first to make sure the site is up.",
  "empty-body":
    "Check the address in a browser first — there may be nothing on the page for us to read.",
  "widget-detected": null,
  "budget-exceeded": null,
};

/** Message + next step for a run that produced no pages. */
export function failureFor(warnings: ScrapeWarning[]): {
  message: string;
  hint: string | null;
} {
  // Ordered by how much it explains: a robots block is the reason we stopped,
  // while the fetch failure it sits next to is only a symptom.
  const ranked: WarningCode[] = [
    "robots-disallow",
    "bot-challenge",
    "redirect-offsite",
    "non-html",
    "js-rendered",
    "fetch-failed",
    "empty-body",
  ];

  for (const code of ranked) {
    const warning = warnings.find((candidate) => candidate.code === code);
    if (warning) return { message: warning.message, hint: HINTS[code] };
  }

  return {
    message: warnings[0]?.message ?? "We couldn't read anything at that address.",
    hint: HINTS["fetch-failed"],
  };
}
