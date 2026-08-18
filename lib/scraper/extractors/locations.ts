import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { visibleText } from "./contact";

/**
 * Areas served.
 *
 * `Service Locations` is filled in all eight reference profiles and is the
 * largest set field in the whole comparison — 59 values across seven sites — so
 * a scraper that only reads JSON-LD `areaServed` (present on one site) misses
 * almost all of it.
 *
 * SMB sites publish this in two recognisable shapes: a heading like "Areas We
 * Serve" above a list of towns, and a sentence in the footer that names the
 * region. Both are read here; anything else is left alone, because a
 * place-name detector loose enough to work on arbitrary prose returns the state
 * in every mailing address and the city in every testimonial.
 */

const AREA_HEADING =
  /\b(areas?\s+(we\s+)?serve[sd]?|service\s+areas?|communities?\s+we\s+serve|where\s+we\s+work|locations?\s+we\s+serve|proudly\s+serving|now\s+serving)\b/i;

/**
 * "Proudly Serving The Texas Hill Country", "serving Austin, Bee Cave and
 * Spicewood".
 *
 * `serving`/`serves` only, never the bare infinitive: "we serve a wide range of
 * clients" and "the communities we serve. Ready to…" both follow "serve" with
 * something that is not a place, and no amount of filtering downstream reliably
 * tells those apart from a real one.
 */
// Deliberately not `/i`: the case-insensitive flag would also relax the `[A-Z]`
// in the capture, and "capitalised" is most of what identifies a place name.
const SERVING_SENTENCE =
  /\b(?:[Pp]roudly\s+)?[Ss]erv(?:ing|es)\s+((?:[A-Z][A-Za-z.'-]*(?:\s+(?!Since|Est|For|With|And|Our|We|Since)[A-Z][A-Za-z.'-]*){0,4})(?:\s*,\s*(?:and\s+)?(?:the\s+)?[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}){0,15})/g;

const MAX_LOCATION_LENGTH = 60;
const MAX_LOCATIONS = 40;

/**
 * Words that mark a matched phrase as prose rather than a place.
 *
 * The trade names are there because a company named after the region it serves
 * is normal — "Texas Hill Country Pumping" is a sister brand of Bee Cave
 * Drilling, and it sat in the service-area list looking exactly like a place.
 */
const NOT_A_PLACE =
  /\b(customer|client|business|home|owner|need|since|year|community|team|company|service|quality|water|well|call|contact|free|estimate|and more|others|pumping|drilling|plumbing|roofing|hvac|electric(?:al)?|landscaping|cleaning|repair|inspections?|monitoring|realty|group|associates|insurance|agency|solutions)\b/i;

/**
 * Audiences, not places. "Serving SMBs" and "serving homeowners" match the same
 * sentence shape as "serving Austin" — they are evidence for `market.buyers`,
 * which prompt 01 fills, and recording them as locations would be wrong twice.
 */
const AN_AUDIENCE =
  /^(smbs?|smes?|clients?|customers?|businesses|companies|brands?|agencies|dealers?|contractors?|homeowners?|families|professionals?|realtors?|investors?|patients?|students?)$/i;

export function extractLocations(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const found = new Map<string, LocationHit>();

  /* ------------------------------------------- lists under a heading */

  $("h1, h2, h3, h4, h5, h6, strong, [class*='title' i]").each((_, element) => {
    const heading = $(element).text().replace(/\s+/g, " ").trim();
    if (!heading || heading.length > 80 || !AREA_HEADING.test(heading)) return;

    // The list is normally the next sibling; on card layouts it is inside the
    // heading's own section, so both are checked.
    const scope = $(element).nextAll("ul, ol, div, p").slice(0, 3);
    const items = scope.find("li, a").addBack("ul, ol").find("li").toArray();

    for (const item of items) {
      addLocation(found, $(item).text(), "dom");
    }

    // "Serving Austin, Bee Cave, Lakeway, Spicewood and Dripping Springs."
    const paragraph = scope.filter("p").first().text();
    for (const name of splitList(paragraph)) addLocation(found, name, "dom");
  });

  /* --------------------------------------------- "serving X, Y, Z" */

  const text = visibleText($);
  for (const match of text.matchAll(SERVING_SENTENCE)) {
    for (const name of splitList(match[1])) addLocation(found, name, "heuristic");
  }

  void site;

  return [...found.values()]
    .slice(0, MAX_LOCATIONS)
    .map((entry) =>
      evidence("foundation.serviceLocations", entry.name, entry.method, page, {
        confidence: entry.method === "dom" ? 0.7 : 0.5,
      }),
    );
}

function splitList(value: string): string[] {
  return value
    .replace(/\s+/g, " ")
    .split(/\s*(?:,|;|·|\||\band\b|&)\s*/i)
    .map((part) => part.replace(/^the\s+/i, "").replace(/[.!?]+$/, "").trim());
}

type LocationHit = { name: string; method: "dom" | "heuristic" };

function addLocation(
  found: Map<string, LocationHit>,
  raw: string,
  method: "dom" | "heuristic",
): void {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length < 3 || name.length > MAX_LOCATION_LENGTH) return;
  if (NOT_A_PLACE.test(name)) return;
  if (AN_AUDIENCE.test(name)) return;
  // A place name is capitalised and short. "Dripping Springs" and "TX" pass;
  // "we serve the entire region" does not.
  if (!/^[A-Z]/.test(name)) return;
  if (name.split(/\s+/).length > 5) return;

  const key = name.toLowerCase();
  // A name found under an "Areas We Serve" heading beats the same name matched
  // out of a sentence, so a DOM hit is never downgraded by a later heuristic.
  if (found.get(key)?.method === "dom") return;
  found.set(key, { name, method });
}
