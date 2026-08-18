import type { PageRole, ScrapeWarning } from "@/lib/schema";
import type { ScrapeEvent, ScrapeStage } from "@/lib/scraper/events";

/**
 * Folding the NDJSON event stream into something renderable.
 *
 * A reducer rather than a pile of `useState` calls, and a pure one in `lib/` so
 * it can be tested against a recorded event sequence without a browser. The
 * events arrive in the low hundreds for a twenty-page crawl, so the state it
 * keeps is deliberately bounded: counts, not history.
 */

export const STAGES: ScrapeStage[] = ["crawl", "extract", "enrich"];

export const STAGE_LABELS: Record<ScrapeStage, { running: string; done: string }> = {
  crawl: { running: "Reading the website", done: "Website read" },
  extract: { running: "Pulling out the details", done: "Details pulled out" },
  enrich: { running: "Writing the summaries", done: "Summaries written" },
};

export type ProgressState = {
  /** The stage now running, or `null` before the first event and after the last. */
  stage: ScrapeStage | null;
  completed: ScrapeStage[];
  pagesFetched: number;
  budget: number;
  /** URLs found, whether or not we had budget left to read them. */
  discovered: number;
  robots: { found: boolean; crawlDelayMs: number } | null;
  /** Most recent first, capped — this is a status display, not a log viewer. */
  pages: Array<{ url: string; role: PageRole }>;
  warnings: ScrapeWarning[];
  durationMs: number | null;
};

/** Enough recent pages to show something moving, few enough to stay scannable. */
const PAGE_HISTORY = 8;

export const initialProgress: ProgressState = {
  stage: null,
  completed: [],
  pagesFetched: 0,
  budget: 0,
  discovered: 0,
  robots: null,
  pages: [],
  warnings: [],
  durationMs: null,
};

export function progressReducer(
  state: ProgressState,
  event: ScrapeEvent,
): ProgressState {
  switch (event.kind) {
    case "stage":
      return event.status === "start"
        ? { ...state, stage: event.stage }
        : {
            ...state,
            stage: state.stage === event.stage ? null : state.stage,
            completed: state.completed.includes(event.stage)
              ? state.completed
              : [...state.completed, event.stage],
          };

    case "crawl":
      return applyCrawlEvent(state, event.event);

    default:
      return state;
  }
}

function applyCrawlEvent(
  state: ProgressState,
  event: Extract<ScrapeEvent, { kind: "crawl" }>["event"],
): ProgressState {
  switch (event.type) {
    case "robots":
      return {
        ...state,
        robots: { found: event.found, crawlDelayMs: event.crawlDelayMs },
      };

    case "discovered":
      return { ...state, discovered: state.discovered + event.count };

    case "page":
      return {
        ...state,
        pagesFetched: event.fetched,
        budget: event.budget,
        pages: [{ url: event.url, role: event.role }, ...state.pages].slice(
          0,
          PAGE_HISTORY,
        ),
      };

    case "warning":
      // Warnings repeat — a site that times out once usually times out again,
      // and eight copies of the same sentence reads as eight problems.
      return state.warnings.some(
        (warning) => warning.message === event.warning.message,
      )
        ? state
        : { ...state, warnings: [...state.warnings, event.warning] };

    case "done":
      return { ...state, durationMs: event.durationMs };

    default:
      return state;
  }
}

/** Short, human page-type labels for the progress list. */
export const ROLE_LABELS: Record<PageRole, string> = {
  home: "Home",
  about: "About",
  services: "Services",
  products: "Products",
  pricing: "Pricing",
  contact: "Contact",
  team: "Team",
  testimonials: "Reviews",
  faq: "FAQ",
  "blog-index": "Blog",
  "blog-post": "Article",
  legal: "Legal",
  other: "Page",
};

/** `https://example.com/about-us` → `/about-us`, which is what fits on a line. */
export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}` === "/" ? "/" : `${pathname}${search}`;
  } catch {
    return url;
  }
}
