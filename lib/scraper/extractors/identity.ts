import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { readableText, visibleText } from "./contact";

/**
 * Founding year, legal name, and entity type from the copy that carries them.
 *
 * `yearFounded` appears in three of the eight reference profiles and in exactly
 * one JSON-LD block across the whole golden set — every other instance is a
 * tagline ("Proudly Serving The Texas Hill Country Since 1980") or a footer
 * line. Tier 2 of the fallback chain in docs/DATA-QUALITY.md §3 is this file.
 *
 * What is deliberately *not* read: the copyright year. "© 2007-2023" is when the
 * site was built, and a business that rebuilt its site in 2007 after opening in
 * 1974 would get a founding year that is wrong by three decades — with no way
 * for the customer to see where the number came from.
 */

const SINCE =
  /\b(?:since|est\.?|established(?:\s+in)?|serving\s+[^.,;]{0,50}\s+since|in\s+business\s+since|family[- ]owned\s+since)\s+((?:18|19|20)\d{2})\b/gi;

/** "© 2007-2023 Bee Cave Drilling, All Rights Reserved" */
const COPYRIGHT_LINE = /(?:©|\(c\)|copyright)([^|\n]{3,120})/i;

/** Everything a copyright line carries that is not the company's name. */
const COPYRIGHT_NOISE =
  /\ball\s+rights\s+reserved\b.*$|\bcopyright\b|©|\(c\)|(?:18|19|20)\d{2}(?:\s*[-–—]\s*(?:18|19|20)\d{2})?/gi;

/**
 * The rest of the footer, which sits on the same line as the copyright notice
 * once the markup is flattened. Cutting at the first of these keeps the name and
 * drops the menu: "Bee Cave Drilling · Privacy Policy · Site by Acme" → "Bee
 * Cave Drilling".
 */
const FOOTER_TAIL =
  /\b(privacy(?:\s+policy)?|terms(?:\s+(?:of\s+)?(?:use|service|and\s+conditions))?|cookie\s+policy|sitemap|accessibility|disclaimer|all\s+rights|web(?:site)?\s+(?:design|development|by)|designed?\s+by|developed\s+by|powered\s+by|built\s+by|marketing\s+by)\b[\s\S]*$/i;

/** Legal suffixes, as written. */
const ENTITY_SUFFIX =
  /\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Ltd\.?|Corp\.?|Corporation|LLP|PLLC|P\.C\.|PA)\b\s*$/i;

export function extractIdentity(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];
  const text = visibleText($);

  /* ------------------------------------------------------ founding year */

  const currentYear = new Date().getFullYear();
  const years = new Set<number>();
  for (const match of text.matchAll(SINCE)) {
    const year = Number(match[1]);
    if (year >= 1600 && year <= currentYear) years.add(year);
  }

  for (const year of years) {
    out.push(
      evidence("foundation.yearFounded", year, "heuristic", page, {
        confidence: years.size > 1 ? 0.4 : 0.55,
        note: years.size > 1 ? "Several 'since' years appear on the site" : undefined,
      }),
    );
  }

  /* -------------------------------------------------- legal / alt name */

  // The copyright line is where a company writes its registered name, which is
  // usually not the name in the logo: "Account-it Consulting Services, LLC".
  // `readableText`, not `.text()`: the footer is where element boundaries fuse
  // words most often, and "Bee Cave Drilling, All Rights ReservedPrivacy Policy"
  // is what a company's registered name looked like before this.
  const footer = readableText($("footer")) || text.slice(-1200);
  const line = footer.replace(/\s+/g, " ").match(COPYRIGHT_LINE)?.[1] ?? null;
  const legalName = line
    ? line
        .replace(COPYRIGHT_NOISE, " ")
        .replace(FOOTER_TAIL, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s,.|·©-]+|[\s,.|·©-]+$/g, "")
        .trim()
    : null;

  if (legalName && legalName.length >= 4 && legalName.length <= 70 && /^[A-Z]/.test(legalName) && /[a-z]/.test(legalName)) {
    out.push(
      evidence("foundation.altNames", legalName, "heuristic", page, { confidence: 0.5 }),
    );

    const suffix = legalName.match(ENTITY_SUFFIX);
    if (suffix) {
      out.push(
        evidence("foundation.legalEntityType", suffix[1].replace(/\.$/, ""), "heuristic", page, {
          confidence: 0.6,
        }),
      );
    }
  }

  void site;
  return out;
}
