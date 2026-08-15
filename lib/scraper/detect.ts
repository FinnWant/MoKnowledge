import * as cheerio from "cheerio";

/**
 * Detecting what we can't read.
 *
 * ROADMAP §10 locks in "no headless browser" — cheerio only. The honest
 * consequence is that some sites are unreadable, and the product decision is to
 * say so specifically rather than return a suspiciously empty knowledge base.
 * These detectors are what make the messages in docs/DATA-QUALITY.md §7 possible.
 */

/** Below this much visible text, a page is almost certainly rendered client-side. */
const THIN_TEXT_THRESHOLD = 300;

export type JsRenderedVerdict = {
  isJsRendered: boolean;
  /** Framework or builder we recognised, for the user-facing message. */
  framework: string | null;
  textLength: number;
};

const FRAMEWORK_MARKERS: Array<[RegExp, string]> = [
  [/<div[^>]+id=["']__next["']/i, "Next.js"],
  [/<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i, "React"],
  [/<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i, "Vue"],
  [/ng-version=|<app-root/i, "Angular"],
  [/data-reactroot/i, "React"],
  [/window\.__NUXT__/i, "Nuxt"],
  [/<div[^>]+class=["'][^"']*svelte-/i, "Svelte"],
];

export function detectJsRendered(html: string): JsRenderedVerdict {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  const textLength = $("body").text().replace(/\s+/g, " ").trim().length;

  let framework: string | null = null;
  for (const [pattern, name] of FRAMEWORK_MARKERS) {
    if (pattern.test(html)) {
      framework = name;
      break;
    }
  }

  // A framework marker alone is not enough — plenty of Next.js sites
  // server-render perfectly readable HTML. It's the empty body that matters.
  return {
    isJsRendered: textLength < THIN_TEXT_THRESHOLD,
    framework,
    textLength,
  };
}

/**
 * Third-party review widgets, whose content loads separately and is therefore
 * invisible to us. Worth naming in the warning: "we found a Birdeye widget but
 * couldn't read the reviews" is actionable, "no testimonials found" is not.
 */
const REVIEW_WIDGETS: Array<[RegExp, string]> = [
  [/birdeye\.com|birdeye_|bdreview/i, "Birdeye"],
  [/trustpilot\.com\/(bootstrap|widget)|tp-widget/i, "Trustpilot"],
  [/yotpo\.com|yotpo-widget/i, "Yotpo"],
  [/podium\.com|podium-widget/i, "Podium"],
  [/nicejob\.co|nicejob-/i, "NiceJob"],
  [/grade\.us|reviewsonmywebsite/i, "Grade.us"],
  [/elfsight\.com.*google-reviews|elfsight-app/i, "Elfsight"],
  [/reviews\.io|reviewsio/i, "Reviews.io"],
  [/shopperapproved\.com/i, "Shopper Approved"],
];

export function detectReviewWidgets(html: string): string[] {
  const found = new Set<string>();
  for (const [pattern, name] of REVIEW_WIDGETS) {
    if (pattern.test(html)) found.add(name);
  }
  return [...found];
}
