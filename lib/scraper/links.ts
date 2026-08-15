import * as cheerio from "cheerio";
// cheerio v1 does not re-export its node types; they live in domhandler, which it
// depends on and which supplies the element type the `.each` callback yields.
import type { AnyNode } from "domhandler";
import { isSameSite, looksLikeHtmlPage, normalizeUrl } from "@/lib/utils/url";

/**
 * Link discovery from a fetched page.
 *
 * Navigation and footer links are weighted above body links, because a site's own
 * nav is the best available statement of which pages it considers important —
 * and on an SMB site that is almost exactly the set we want.
 */

export type DiscoveredLink = {
  url: string;
  anchorText: string;
  /** Bonus added to the classifier's priority, by where the link was found. */
  placementBonus: number;
};

const PLACEMENT_BONUS = {
  nav: 15,
  footer: 8,
  body: 0,
} as const;

export function extractLinks(
  html: string,
  pageUrl: string,
  originUrl: string = pageUrl,
): DiscoveredLink[] {
  const $ = cheerio.load(html);
  const found = new Map<string, DiscoveredLink>();

  const consider = (
    element: AnyNode,
    placement: keyof typeof PLACEMENT_BONUS,
  ) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    if (!href) return;

    const url = normalizeUrl(href, pageUrl);
    if (!url) return;
    if (!isSameSite(url, originUrl)) return;
    if (!looksLikeHtmlPage(url)) return;

    const anchorText = anchor.text().replace(/\s+/g, " ").trim().slice(0, 120);
    const bonus = PLACEMENT_BONUS[placement];
    const existing = found.get(url);

    // The same page is often linked from a nav with a good label and from a body
    // paragraph with "click here". Placement decides, and length only breaks a
    // tie within one placement — otherwise the longest string wins, which is
    // exactly backwards.
    if (!existing || bonus > existing.placementBonus) {
      found.set(url, { url, anchorText, placementBonus: bonus });
    } else if (
      bonus === existing.placementBonus &&
      anchorText.length > existing.anchorText.length
    ) {
      existing.anchorText = anchorText;
    }
  };

  $("nav a[href], header a[href], [role='navigation'] a[href]").each((_, el) =>
    consider(el, "nav"),
  );
  $("footer a[href], [class*='footer'] a[href]").each((_, el) =>
    consider(el, "footer"),
  );
  $("a[href]").each((_, el) => consider(el, "body"));

  return [...found.values()];
}

/** The `<link rel="canonical">` target, when the page declares one. */
export function extractCanonical(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const href = $("link[rel='canonical']").attr("href");
  return href ? normalizeUrl(href, pageUrl) : null;
}
